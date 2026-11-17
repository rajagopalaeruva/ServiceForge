package com.serviceforge.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.serviceforge.ServiceForgeApplication;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Feature 2, T-8, AC-22 (plan 2.2, Restart): a reservation is made in one application context; a second,
 * separate application context is then started and must show the A-1 catalogue and no reservations.
 * Both contexts use a random free port (server.port=0); port 8080 is never used.
 */
class Feature2RestartHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    private static ConfigurableApplicationContext start() {
        return new SpringApplicationBuilder(ServiceForgeApplication.class)
                .properties("server.port=0", "spring.main.banner-mode=off")
                .run();
    }

    private static String port(ConfigurableApplicationContext ctx) {
        return ctx.getEnvironment().getProperty("local.server.port");
    }

    private static HttpResponse<String> send(HttpRequest req) throws Exception {
        return CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
    }

    private static HttpResponse<String> get(String port, String path) throws Exception {
        return send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build());
    }

    private static void assertSeedStock(String port) throws Exception {
        HttpResponse<String> r = get(port, "/api/parts");
        assertEquals(200, r.statusCode());
        JsonNode arr = JSON.readTree(r.body());
        int[] expected = {12, 25, 6, 3, 0};
        assertEquals(5, arr.size());
        for (int i = 0; i < 5; i++) {
            assertEquals(i + 1, arr.get(i).get("id").asInt());
            assertEquals(expected[i], arr.get(i).get("available").asInt(), "part " + (i + 1));
        }
    }

    @Test
    void F2_AC_22_freshContextAfterReservationsShowsSeedStockAndNoReservations() throws Exception {
        try (ConfigurableApplicationContext first = start()) {
            String p1 = port(first);
            HttpResponse<String> post = send(HttpRequest.newBuilder(
                            URI.create("http://localhost:" + p1 + "/api/jobs/1/reservations"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(
                            "{\"lines\":[{\"partId\":1,\"quantity\":3},{\"partId\":2,\"quantity\":4}]}"))
                    .build());
            assertEquals(201, post.statusCode(), "the reservation in the first context must be granted");
            assertEquals(9, JSON.readTree(get(p1, "/api/parts").body()).get(0).get("available").asInt());
        }
        try (ConfigurableApplicationContext second = start()) {
            String p2 = port(second);
            assertSeedStock(p2);
            for (int job = 1; job <= 3; job++) {
                HttpResponse<String> r = get(p2, "/api/jobs/" + job + "/reservations");
                assertEquals(200, r.statusCode());
                assertEquals(0, JSON.readTree(r.body()).size(), "job " + job + " must have no reservations");
            }
        }
    }

    @Test
    void ADR003_AC_22_restartReturnsSeedStockAndNoReservations() throws Exception {
        try (ConfigurableApplicationContext first = start()) {
            send(HttpRequest.newBuilder(URI.create("http://localhost:" + port(first) + "/api/jobs/2/reservations"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString("{\"lines\":[{\"partId\":3,\"quantity\":6}]}"))
                    .build());
        }
        try (ConfigurableApplicationContext second = start()) {
            String p = port(second);
            assertSeedStock(p);
            assertEquals(0, JSON.readTree(get(p, "/api/jobs/2/reservations").body()).size());
        }
    }
}
