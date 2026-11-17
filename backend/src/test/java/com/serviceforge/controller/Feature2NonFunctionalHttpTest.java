package com.serviceforge.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.annotation.DirtiesContext;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Feature 2, T-9: NFR-3 (timed run, 95th percentile against 500 ms) and NFR-4 (stock invariant after a
 * concurrency run). A real embedded server on a random port (never 8080), a fresh application context for every
 * test method, seed data from assumption A-1 (parts 1 to 5 with 12, 25, 6, 3 and 0 available).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
class Feature2NonFunctionalHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int[] SEEDED = {12, 25, 6, 3, 0};
    private static final long LIMIT_MS = 500;

    @LocalServerPort
    private int port;

    private final HttpClient client = HttpClient.newHttpClient();

    private HttpResponse<String> get(String path) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> reserve(long jobId, String body) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port
                        + "/api/jobs/" + jobId + "/reservations"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }

    private static long percentile95Millis(long[] nanos) {
        long[] sorted = nanos.clone();
        Arrays.sort(sorted);
        int rank = (int) Math.ceil(0.95 * sorted.length);      // nearest rank: the 95th of 100 values
        return TimeUnit.NANOSECONDS.toMicros(sorted[rank - 1]);
    }

    private static void record(String name, long p95Micros, long maxMicros, String detail) throws Exception {
        String line = name + ": p95=" + p95Micros / 1000.0 + " ms, max=" + maxMicros / 1000.0
                + " ms, limit=" + LIMIT_MS + " ms, " + detail;
        System.out.println("T9-RESULT " + line);
        Path out = Path.of("target", "f2-nfr3-result.txt");
        Files.createDirectories(out.getParent());
        Files.writeString(out, line + System.lineSeparator(), StandardCharsets.UTF_8,
                java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
    }

    @Test
    void F2_NFR_3_stockViewP95IsWithin500msOver100SequentialRequests() throws Exception {
        long[] nanos = new long[100];
        for (int i = 0; i < 100; i++) {
            long start = System.nanoTime();
            HttpResponse<String> r = get("/api/parts");
            nanos[i] = System.nanoTime() - start;
            assertEquals(200, r.statusCode(), "request " + (i + 1));
        }
        long p95 = percentile95Millis(nanos);
        long max = TimeUnit.NANOSECONDS.toMicros(Arrays.stream(nanos).max().getAsLong());
        record("stock view", p95, max, "100 requests, fresh context, no warm-up");
        assertTrue(p95 <= LIMIT_MS * 1000, "p95 of the stock view was " + p95 / 1000.0 + " ms");
    }

    @Test
    void F2_NFR_3_reservationRequestP95IsWithin500msOver100SequentialRequestsGrantedAndRejected() throws Exception {
        long[] nanos = new long[100];
        int granted = 0;
        int rejected = 0;
        for (int i = 0; i < 100; i++) {
            long partId = (i % 4) + 1;       // parts 1 to 4 in turn: 46 units in total, so 46 grants and 54 rejections
            long start = System.nanoTime();
            HttpResponse<String> r = reserve(1, "{\"lines\":[{\"partId\":" + partId + ",\"quantity\":1}]}");
            nanos[i] = System.nanoTime() - start;
            if (r.statusCode() == 201) {
                granted++;
            } else if (r.statusCode() == 409) {
                rejected++;
            } else {
                throw new AssertionError("request " + (i + 1) + " returned " + r.statusCode() + ": " + r.body());
            }
        }
        long p95 = percentile95Millis(nanos);
        long max = TimeUnit.NANOSECONDS.toMicros(Arrays.stream(nanos).max().getAsLong());
        record("reservation", p95, max, "100 requests, " + granted + " granted, " + rejected
                + " rejected (both counted), fresh context, no warm-up");
        assertEquals(46, granted, "granted count (12+25+6+3 units, one unit per request)");
        assertEquals(54, rejected, "rejected count");
        assertTrue(p95 <= LIMIT_MS * 1000, "p95 of the reservation request was " + p95 / 1000.0 + " ms");
    }

    @Test
    void F2_NFR_4_availablePlusReservedEqualsSeededAfterAndDuringAConcurrencyRun() throws Exception {
        int threads = 40;
        int requestsPerThread = 5;
        long[] jobIds = {1, 2, 3};
        int[][] grantedPerJob = new int[3][5];          // [job index][part index] granted units
        AtomicInteger granted = new AtomicInteger();
        AtomicInteger rejected = new AtomicInteger();
        AtomicBoolean running = new AtomicBoolean(true);
        List<String> violations = java.util.Collections.synchronizedList(new ArrayList<>());

        // Observer: while the run is in progress, every stock view must show 0 <= available <= seeded.
        Thread observer = new Thread(() -> {
            try {
                while (running.get()) {
                    JsonNode parts = JSON.readTree(get("/api/parts").body());
                    for (int i = 0; i < parts.size(); i++) {
                        int available = parts.get(i).get("available").asInt();
                        if (available < 0 || available > SEEDED[i]) {
                            violations.add("part " + (i + 1) + " available " + available);
                        }
                    }
                }
            } catch (Exception e) {
                violations.add("observer failed: " + e);
            }
        });

        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch ready = new CountDownLatch(threads);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();
        observer.start();
        for (int t = 0; t < threads; t++) {
            final int seed = t;
            futures.add(pool.submit(() -> {
                Random random = new Random(1000 + seed);
                ready.countDown();
                go.await();
                for (int n = 0; n < requestsPerThread; n++) {
                    int jobIndex = random.nextInt(3);
                    int partIndex = random.nextInt(4);        // parts 1 to 4 (part 5 has 0 units)
                    int quantity = 1 + random.nextInt(3);
                    HttpResponse<String> r = reserve(jobIds[jobIndex],
                            "{\"lines\":[{\"partId\":" + (partIndex + 1) + ",\"quantity\":" + quantity + "}]}");
                    if (r.statusCode() == 201) {
                        granted.incrementAndGet();
                        synchronized (grantedPerJob) {
                            grantedPerJob[jobIndex][partIndex] += quantity;
                        }
                    } else if (r.statusCode() == 409) {
                        rejected.incrementAndGet();
                    } else {
                        violations.add("unexpected status " + r.statusCode() + ": " + r.body());
                    }
                }
                return null;
            }));
        }
        ready.await();
        go.countDown();
        for (Future<?> f : futures) {
            f.get(60, TimeUnit.SECONDS);
        }
        pool.shutdown();
        running.set(false);
        observer.join(10_000);

        assertTrue(violations.isEmpty(), "violations during the run: " + violations);
        assertEquals(threads * requestsPerThread, granted.get() + rejected.get(), "every request was answered 201 or 409");
        assertTrue(granted.get() > 0 && rejected.get() > 0,
                "the run must contain both grants and rejections to exercise the invariant");

        JsonNode parts = JSON.readTree(get("/api/parts").body());
        for (int p = 0; p < 5; p++) {
            int reservedByResponses = 0;
            for (int j = 0; j < 3; j++) {
                reservedByResponses += grantedPerJob[j][p];
            }
            int available = parts.get(p).get("available").asInt();
            assertTrue(available >= 0, "part " + (p + 1) + " available is " + available);
            assertEquals(SEEDED[p], available + reservedByResponses, "part " + (p + 1) + ": available + reserved");
        }

        // The jobs' reservation lists agree with the grants the clients saw.
        for (int j = 0; j < 3; j++) {
            JsonNode lines = JSON.readTree(get("/api/jobs/" + jobIds[j] + "/reservations").body());
            int[] listed = new int[5];
            for (JsonNode line : lines) {
                listed[line.get("partId").asInt() - 1] += line.get("quantity").asInt();
            }
            assertEquals(Arrays.toString(grantedPerJob[j]), Arrays.toString(listed), "job " + jobIds[j] + " reservations");
        }
    }
}
