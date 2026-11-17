package com.serviceforge.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.serviceforge.data.MockDataStore;
import com.serviceforge.model.Job;
import com.serviceforge.model.JobStatus;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Independent HTTP tests, Feature 2, task T-8b: atomicity, exact stock, repeats, concurrency,
 * completed jobs. Written from the spec, ADR-001, ADR-002 and plan sections 2.1 and 2.2 only.
 *
 * Each test starts from a fresh application context (plan 2.2, State). The extra property gives
 * this class its own context cache key, so even the first test starts from seed data.
 * Seed (A-1): parts 1..5 = 12, 25, 6, 3, 0. Jobs 1, 2, 3 are SCHEDULED.
 */
@SpringBootTest(properties = "serviceforge.test.suite=f2-t8b")
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class PartsReservationAtomicityHttpTest {

    private static final int[] PART_IDS = {1, 2, 3, 4, 5};
    private static final int[] SEED = {12, 25, 6, 3, 0};

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private MockDataStore dataStore;

    private final ObjectMapper mapper = new ObjectMapper();

    // ---------------------------------------------------------------- helpers

    private static String body(int... partQuantityPairs) {
        StringBuilder sb = new StringBuilder("{\"lines\":[");
        for (int i = 0; i < partQuantityPairs.length; i += 2) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append("{\"partId\":").append(partQuantityPairs[i])
                    .append(",\"quantity\":").append(partQuantityPairs[i + 1]).append('}');
        }
        return sb.append("]}").toString();
    }

    private int reserve(long jobId, String json) throws Exception {
        return mockMvc.perform(post("/api/jobs/" + jobId + "/reservations")
                        .contentType(MediaType.APPLICATION_JSON).content(json))
                .andReturn().getResponse().getStatus();
    }

    private String reserveMessage(long jobId, String json) throws Exception {
        String content = mockMvc.perform(post("/api/jobs/" + jobId + "/reservations")
                        .contentType(MediaType.APPLICATION_JSON).content(json))
                .andReturn().getResponse().getContentAsString();
        return mapper.readTree(content).path("message").asText();
    }

    private Map<Integer, Integer> stock() throws Exception {
        String content = mockMvc.perform(get("/api/parts")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        Map<Integer, Integer> result = new HashMap<>();
        for (JsonNode n : mapper.readTree(content)) {
            result.put(n.get("id").asInt(), n.get("available").asInt());
        }
        return result;
    }

    private Map<Integer, Integer> reservations(long jobId) throws Exception {
        String content = mockMvc.perform(get("/api/jobs/" + jobId + "/reservations"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        Map<Integer, Integer> result = new HashMap<>();
        for (JsonNode n : mapper.readTree(content)) {
            result.put(n.get("partId").asInt(), n.get("quantity").asInt());
        }
        return result;
    }

    private void assertSeedStock() throws Exception {
        Map<Integer, Integer> s = stock();
        for (int i = 0; i < PART_IDS.length; i++) {
            assertEquals(SEED[i], s.get(PART_IDS[i]), "available quantity of part " + PART_IDS[i]);
        }
    }

    private void setJobStatus(long jobId, JobStatus newStatus) {
        Job job = dataStore.getAllJobs().stream().filter(j -> j.getId() == jobId).findFirst().orElseThrow();
        job.setStatus(newStatus);
    }

    /** Runs the callables released together; returns their status codes. */
    private List<Integer> raceAll(List<Callable<Integer>> tasks) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(tasks.size());
        try {
            CountDownLatch ready = new CountDownLatch(tasks.size());
            CountDownLatch go = new CountDownLatch(1);
            List<Future<Integer>> futures = new ArrayList<>();
            for (Callable<Integer> task : tasks) {
                futures.add(pool.submit(() -> {
                    ready.countDown();
                    go.await();
                    return task.call();
                }));
            }
            assertTrue(ready.await(10, TimeUnit.SECONDS), "threads did not become ready");
            go.countDown();
            List<Integer> codes = new ArrayList<>();
            for (Future<Integer> f : futures) {
                codes.add(f.get(30, TimeUnit.SECONDS));
            }
            return codes;
        } finally {
            pool.shutdownNow();
        }
    }

    private static long count(List<Integer> codes, int code) {
        return codes.stream().filter(c -> c == code).count();
    }

    // ---------------------------------------------------------------- AC-6

    @Test
    void ADR001_ADR002_F2_AC_6_insufficientSecondPartRejectsWholeRequestAndRecordsNothing() throws Exception {
        mockMvc.perform(post("/api/jobs/1/reservations").contentType(MediaType.APPLICATION_JSON)
                        .content(body(1, 5, 4, 4)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").isNotEmpty());

        assertSeedStock();
        assertTrue(reservations(1).isEmpty(), "no reservation may be recorded for part 1 (or any part)");
    }

    // ---------------------------------------------------------------- ADR-002 stock message (Q-A)

    @Test
    void ADR002_F2_AC_6_stockMessageNamesFirstShortPartByAscendingIdWithRequestedAndAvailable() throws Exception {
        // part 3: 7 requested, 6 available; part 4: 4 requested, 3 available. Both short; part 3 is first.
        String json = body(4, 4, 3, 7);
        mockMvc.perform(post("/api/jobs/1/reservations").contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("3")))
                .andExpect(jsonPath("$.message", containsString("7")))
                .andExpect(jsonPath("$.message", containsString("6")));
        assertSeedStock();
        assertTrue(reservations(1).isEmpty());
    }

    // ---------------------------------------------------------------- AC-7 (exact stock)

    @Test
    void F2_AC_7_reservingExactlyTheAvailableQuantityIsGrantedThenOneMoreIsRejected() throws Exception {
        mockMvc.perform(post("/api/jobs/1/reservations").contentType(MediaType.APPLICATION_JSON)
                        .content(body(4, 3)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.jobId").value(1))
                .andExpect(jsonPath("$.reserved[0].partId").value(4))
                .andExpect(jsonPath("$.reserved[0].quantity").value(3));
        assertEquals(0, stock().get(4));

        mockMvc.perform(post("/api/jobs/1/reservations").contentType(MediaType.APPLICATION_JSON)
                        .content(body(4, 1)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").isNotEmpty());
        assertEquals(0, stock().get(4), "stock must stay at 0, never negative");
        assertEquals(3, reservations(1).get(4));
    }

    // ---------------------------------------------------------------- AC-8 (later request adds to job)

    @Test
    void F2_AC_8_laterReservationForSameJobAddsToRecordedTotal() throws Exception {
        assertEquals(201, reserve(1, body(1, 2)));
        assertEquals(10, stock().get(1));

        mockMvc.perform(post("/api/jobs/1/reservations").contentType(MediaType.APPLICATION_JSON)
                        .content(body(1, 4)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.reserved[0].partId").value(1))
                .andExpect(jsonPath("$.reserved[0].quantity").value(4));

        assertEquals(6, reservations(1).get(1), "recorded total for part 1");
        assertEquals(6, stock().get(1), "part 1 shows 4 less than before the later request (10 -> 6)");
    }

    // ---------------------------------------------------------------- EC-6 (repeats)

    @Test
    void F2_EC_6_sameRequestSentTwiceAppliesTwiceWhenStockAllows() throws Exception {
        String json = body(3, 2);
        assertEquals(201, reserve(1, json));
        assertEquals(201, reserve(1, json));
        assertEquals(2, stock().get(3), "6 - 2 - 2");
        assertEquals(4, reservations(1).get(3));
    }

    @Test
    void F2_EC_6_sameRequestSentTwiceSecondFailsWhenStockDoesNotAllow() throws Exception {
        String json = body(4, 2);
        assertEquals(201, reserve(1, json));
        assertEquals(409, reserve(1, json));
        assertEquals(1, stock().get(4), "only the first request applied");
        assertEquals(2, reservations(1).get(4));
    }

    // ---------------------------------------------------------------- EC-7 (completed / cancelled after reserving)

    @Test
    void F2_EC_7_completedJobKeepsReservationAndStockIsNotReleasedAndNewReservationIs409() throws Exception {
        assertEquals(201, reserve(1, body(1, 2, 2, 3)));
        setJobStatus(1, JobStatus.COMPLETED);

        assertEquals(10, stock().get(1));
        assertEquals(22, stock().get(2));
        Map<Integer, Integer> kept = reservations(1);
        assertEquals(2, kept.get(1));
        assertEquals(3, kept.get(2));

        mockMvc.perform(post("/api/jobs/1/reservations").contentType(MediaType.APPLICATION_JSON)
                        .content(body(1, 1)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("1")))
                .andExpect(jsonPath("$.message", containsString("COMPLETED")));

        assertEquals(10, stock().get(1), "rejected request changes nothing");
        assertEquals(2, reservations(1).get(1));
    }

    @Test
    void F2_EC_7_cancelledJobKeepsReservationAndStockIsNotReleasedAndNewReservationIs409() throws Exception {
        assertEquals(201, reserve(2, body(3, 4)));
        setJobStatus(2, JobStatus.CANCELLED);

        assertEquals(2, stock().get(3));
        assertEquals(4, reservations(2).get(3));

        mockMvc.perform(post("/api/jobs/2/reservations").contentType(MediaType.APPLICATION_JSON)
                        .content(body(3, 1)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("2")))
                .andExpect(jsonPath("$.message", containsString("CANCELLED")));

        assertEquals(2, stock().get(3));
        assertEquals(4, reservations(2).get(3));
    }

    @Test
    void F2_EC_7_jobCreatedAsCompletedIsRejectedWith409AndNothingChanges() throws Exception {
        long id = dataStore.nextJobId();
        dataStore.save(new Job(id, 1L, "Completed Co",
                LocalDateTime.of(2031, 3, 3, 9, 0), LocalDateTime.of(2031, 3, 3, 10, 0), JobStatus.COMPLETED));

        mockMvc.perform(post("/api/jobs/" + id + "/reservations").contentType(MediaType.APPLICATION_JSON)
                        .content(body(1, 1)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString(String.valueOf(id))))
                .andExpect(jsonPath("$.message", containsString("COMPLETED")));
        assertSeedStock();
        assertTrue(reservations(id).isEmpty());
    }

    // ---------------------------------------------------------------- AC-17 / EC-8 (concurrency)

    @Test
    void ADR001_F2_AC_17_tenConcurrentSingleUnitRequestsGrantExactlyThree() throws Exception {
        List<Callable<Integer>> tasks = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            tasks.add(() -> reserve(1, body(4, 1)));
        }
        List<Integer> codes = raceAll(tasks);

        assertEquals(3, count(codes, 201), "granted");
        assertEquals(7, count(codes, 409), "rejected with 409");
        assertEquals(10, count(codes, 201) + count(codes, 409), "no other status expected");
        assertEquals(0, stock().get(4), "stock is 0 and never negative");
        assertEquals(3, reservations(1).get(4));

        assertStockInvariant();
    }

    @Test
    void ADR001_F2_AC_17_concurrentRequestsAcrossDifferentJobsAndPartsKeepInvariant() throws Exception {
        // 10 threads on part 4 across three jobs, plus 6 threads on part 3 (2 units each, 6 available).
        List<Callable<Integer>> tasks = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            long job = 1 + (i % 3);
            tasks.add(() -> reserve(job, body(4, 1)));
        }
        for (int i = 0; i < 6; i++) {
            long job = 1 + (i % 3);
            tasks.add(() -> reserve(job, body(3, 2)));
        }
        List<Integer> codes = raceAll(tasks);

        assertEquals(16, count(codes, 201) + count(codes, 409), "only 201 or 409 expected");
        Map<Integer, Integer> s = stock();
        assertEquals(0, s.get(4));
        assertEquals(0, s.get(3), "6 units, 2 each: exactly 3 of the 6 requests are granted");
        assertEquals(3 + 3, count(codes, 201), "3 granted for part 4, 3 granted for part 3");
        assertStockInvariant();
    }

    @Test
    void F2_EC_8_twoRequestsRaceForLastUnitExactlyOneIsGranted() throws Exception {
        assertEquals(201, reserve(1, body(4, 2)));
        assertEquals(1, stock().get(4), "one unit left");

        List<Integer> codes = raceAll(List.of(
                () -> reserve(2, body(4, 1)),
                () -> reserve(3, body(4, 1))));

        assertEquals(1, count(codes, 201), "exactly one granted");
        assertEquals(1, count(codes, 409), "the other gets 409");
        assertEquals(0, stock().get(4), "never negative");
        assertStockInvariant();
    }

    /** NFR-4: for each part, available + total reserved over all jobs == seeded quantity. */
    private void assertStockInvariant() throws Exception {
        Map<Integer, Integer> available = stock();
        Map<Integer, Integer> reserved = new HashMap<>();
        for (Job job : dataStore.getAllJobs()) {
            reservations(job.getId()).forEach((part, qty) -> reserved.merge(part, qty, Integer::sum));
        }
        for (int i = 0; i < PART_IDS.length; i++) {
            int part = PART_IDS[i];
            assertTrue(available.get(part) >= 0, "part " + part + " must not be negative");
            assertEquals(SEED[i], available.get(part) + reserved.getOrDefault(part, 0),
                    "available + reserved == seeded for part " + part);
        }
    }

    // ---------------------------------------------------------------- EC-11 (nothing partially applied)

    @Test
    void ADR001_ADR002_F2_EC_11_everyKindOfRejectedRequestLeavesStockAndReservationsUnchanged() throws Exception {
        // an earlier granted request, so "existing reservations unchanged" is also checked
        assertEquals(201, reserve(1, body(1, 2)));
        Map<Integer, Integer> stockBefore = stock();
        Map<Integer, Integer> reservedBefore = reservations(1);

        // 409 insufficient stock on the second line, valid first line
        assertEquals(409, reserve(1, body(2, 5, 4, 4)));
        // 409 aggregate over stock
        assertEquals(409, reserve(1, body(4, 2, 4, 2)));
        // 404 unknown part with a valid line
        assertEquals(404, reserve(1, body(1, 1, 99, 1)));
        // 404 unknown part beats insufficient stock (EC-5), nothing applied
        assertEquals(404, reserve(1, body(4, 9, 99, 1)));
        // 400 duplicate part where one quantity is invalid (EC-3)
        assertEquals(400, reserve(1, "{\"lines\":[{\"partId\":2,\"quantity\":1},{\"partId\":2,\"quantity\":0}]}"));
        // 400 empty lines
        assertEquals(400, reserve(1, "{\"lines\":[]}"));
        // 404 unknown job with valid lines
        assertEquals(404, reserve(999, body(1, 1)));
        // 409 non-SCHEDULED job with valid lines
        long cancelled = dataStore.nextJobId();
        dataStore.save(new Job(cancelled, 1L, "Cancelled Co",
                LocalDateTime.of(2031, 4, 4, 9, 0), LocalDateTime.of(2031, 4, 4, 10, 0), JobStatus.CANCELLED));
        assertEquals(409, reserve(cancelled, body(1, 1, 2, 1)));

        assertEquals(stockBefore, stock(), "stock unchanged by any rejected request");
        assertEquals(reservedBefore, reservations(1), "existing reservation unchanged");
        assertTrue(reservations(2).isEmpty());
        assertTrue(reservations(3).isEmpty());
        assertTrue(reservations(cancelled).isEmpty());
        assertFalse(stock().values().stream().anyMatch(v -> v < 0));
    }
}
