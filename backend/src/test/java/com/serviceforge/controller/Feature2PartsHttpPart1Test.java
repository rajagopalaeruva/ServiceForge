package com.serviceforge.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.serviceforge.data.MockDataStore;
import com.serviceforge.model.Job;
import com.serviceforge.model.JobStatus;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Stream;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.emptyOrNullString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Feature 2, T-8: independent HTTP-level tests, part 1 (stock view, reserve, validation, errors, reads).
 * Written from the spec, ADR-002 to ADR-005 and plan sections 2.1 and 2.2 only.
 * Contract: GET /api/parts; POST /api/jobs/{id}/reservations; GET /api/jobs/{id}/reservations.
 *
 * Each test method starts from a fresh application context (plan 2.2, State), so in-memory state is the seed.
 * Seed (A-1): parts 1..5 = 12, 25, 6, 3, 0. Jobs 1, 2, 3 are SCHEDULED. AC-22 is in Feature2RestartHttpTest.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
class Feature2PartsHttpPart1Test {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final long UNKNOWN_JOB = 9999L;
    private static final int UNKNOWN_PART = 99;

    @Autowired
    private MockMvc mvc;

    @Autowired
    private MockDataStore store;

    // ---------- helpers ----------

    private static String line(Object partId, Object quantity) {
        StringBuilder sb = new StringBuilder("{");
        if (partId != null) {
            sb.append("\"partId\":").append(partId);
        }
        if (quantity != null) {
            if (partId != null) {
                sb.append(",");
            }
            sb.append("\"quantity\":").append(quantity);
        }
        return sb.append("}").toString();
    }

    private static String body(String... lines) {
        return "{\"lines\":[" + String.join(",", lines) + "]}";
    }

    private ResultActions reserve(Object jobId, String rawBody) throws Exception {
        return mvc.perform(post("/api/jobs/" + jobId + "/reservations")
                .contentType(MediaType.APPLICATION_JSON)
                .content(rawBody));
    }

    private Map<Integer, Integer> stock() throws Exception {
        String json = mvc.perform(get("/api/parts")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        Map<Integer, Integer> out = new LinkedHashMap<>();
        for (JsonNode n : JSON.readTree(json)) {
            out.put(n.get("id").asInt(), n.get("available").asInt());
        }
        return out;
    }

    private static Map<Integer, Integer> seed() {
        Map<Integer, Integer> m = new LinkedHashMap<>();
        m.put(1, 12);
        m.put(2, 25);
        m.put(3, 6);
        m.put(4, 3);
        m.put(5, 0);
        return m;
    }

    private void assertStockIsSeed() throws Exception {
        assertEquals(seed(), stock(), "stock must equal the A-1 seed");
    }

    private String reservationsOf(Object jobId) throws Exception {
        return mvc.perform(get("/api/jobs/" + jobId + "/reservations")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private void assertNoReservations(long jobId) throws Exception {
        assertEquals(0, JSON.readTree(reservationsOf(jobId)).size(),
                "job " + jobId + " must have no reservations");
    }

    private long newJob(JobStatus status) {
        long id = store.nextJobId();
        store.save(new Job(id, 3L, "F2 test customer",
                LocalDateTime.of(2031, 3, 3, 9, 0), LocalDateTime.of(2031, 3, 3, 10, 0), status));
        return id;
    }

    private static void assertErrorBody(ResultActions r) throws Exception {
        r.andExpect(jsonPath("$.message", not(emptyOrNullString())));
    }

    // ---------- AC-1 ----------

    @Test
    void F2_AC_1_stockViewListsFiveSeededParts() throws Exception {
        String json = mvc.perform(get("/api/parts")).andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(5)))
                .andReturn().getResponse().getContentAsString();
        JsonNode arr = JSON.readTree(json);
        String[] names = {"Capacitor", "Air filter", "Contactor relay", "Thermostat", "Refrigerant valve"};
        for (int i = 0; i < 5; i++) {
            JsonNode n = arr.get(i);
            assertEquals(i + 1, n.get("id").asInt(), "parts are in ascending id order");
            org.junit.jupiter.api.Assertions.assertTrue(n.get("name").asText().contains(names[i]),
                    "name of part " + (i + 1) + " should contain " + names[i] + " but was " + n.get("name"));
            org.junit.jupiter.api.Assertions.assertTrue(n.get("available").isIntegralNumber(),
                    "available is a whole number");
        }
        assertStockIsSeed();
    }

    // ---------- AC-2 ----------

    @Test
    void F2_AC_2_reserveThreeOfPartOneIsGrantedAndStockDrops() throws Exception {
        reserve(1, body(line(1, 3)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.jobId").value(1))
                .andExpect(jsonPath("$.reserved", hasSize(1)))
                .andExpect(jsonPath("$.reserved[0].partId").value(1))
                .andExpect(jsonPath("$.reserved[0].quantity").value(3));
        Map<Integer, Integer> expected = seed();
        expected.put(1, 9);
        assertEquals(expected, stock());
    }

    // ---------- AC-3 ----------

    @Test
    void F2_AC_3_twoPartsInOneRequestAreBothRecorded() throws Exception {
        reserve(1, body(line(1, 2), line(2, 4)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.jobId").value(1))
                .andExpect(jsonPath("$.reserved", hasSize(2)))
                .andExpect(jsonPath("$.reserved[0].partId").value(1))
                .andExpect(jsonPath("$.reserved[0].quantity").value(2))
                .andExpect(jsonPath("$.reserved[1].partId").value(2))
                .andExpect(jsonPath("$.reserved[1].quantity").value(4));
        Map<Integer, Integer> expected = seed();
        expected.put(1, 10);
        expected.put(2, 21);
        assertEquals(expected, stock());
        mvc.perform(get("/api/jobs/1/reservations")).andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].partId").value(1))
                .andExpect(jsonPath("$[0].quantity").value(2))
                .andExpect(jsonPath("$[1].partId").value(2))
                .andExpect(jsonPath("$[1].quantity").value(4));
    }

    // ---------- AC-4 ----------

    @Test
    void F2_AC_4_duplicatePartLinesAreAggregated() throws Exception {
        reserve(1, body(line(3, 2), line(3, 3)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.reserved", hasSize(1)))
                .andExpect(jsonPath("$.reserved[0].partId").value(3))
                .andExpect(jsonPath("$.reserved[0].quantity").value(5));
        assertEquals(1, stock().get(3));
        mvc.perform(get("/api/jobs/1/reservations")).andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].partId").value(3))
                .andExpect(jsonPath("$[0].quantity").value(5));
    }

    // ---------- AC-5 ----------

    @Test
    void F2_AC_5_aggregateOverStockIsRejectedWith409() throws Exception {
        ResultActions r = reserve(1, body(line(4, 2), line(4, 2))).andExpect(status().isConflict());
        assertErrorBody(r);
        r.andExpect(jsonPath("$.message", containsString("4")));
        assertStockIsSeed();
        assertNoReservations(1);
    }

    @Test
    void ADR002_AC_5_rejectedAggregateChangesNothing() throws Exception {
        reserve(1, body(line(4, 2), line(4, 2))).andExpect(status().isConflict());
        assertStockIsSeed();
        assertNoReservations(1);
    }

    // ---------- AC-9 / EC-1 / EC-2 / ADR-005 / ADR-004 ----------

    static Stream<Arguments> badQuantities() {
        // name, raw JSON fragment for the quantity (null = key absent). Line is {"partId":1,"quantity":<fragment>}.
        return Stream.of(
                Arguments.of("zero", "0"),
                Arguments.of("negative", "-1"),
                Arguments.of("missing", null),
                Arguments.of("jsonNull", "null"),
                Arguments.of("fraction", "1.5"),
                Arguments.of("decimalWholeValue", "2.0"),
                Arguments.of("quotedNumber", "\"2\""),
                Arguments.of("nonNumericString", "\"abc\""),
                Arguments.of("overIntRange", "2147483648"));
    }

    @ParameterizedTest(name = "F2_AC_9 {0}")
    @MethodSource("badQuantities")
    void F2_AC_9_invalidQuantityIsRejectedWith400(String name, String quantity) throws Exception {
        ResultActions r = reserve(1, body(line(1, quantity))).andExpect(status().isBadRequest());
        assertErrorBody(r);
        assertStockIsSeed();
        assertNoReservations(1);
    }

    @ParameterizedTest(name = "ADR005_AC_9 {0}")
    @MethodSource("badQuantities")
    void ADR005_AC_9_strictWholeNumberCases(String name, String quantity) throws Exception {
        reserve(1, body(line(1, quantity))).andExpect(status().isBadRequest());
        assertStockIsSeed();
    }

    @ParameterizedTest(name = "ADR004_AC_9 {0}")
    @MethodSource("badQuantities")
    void ADR004_AC_9_invalidQuantityBodyIsApiError(String name, String quantity) throws Exception {
        assertErrorBody(reserve(1, body(line(1, quantity))).andExpect(status().isBadRequest()));
    }

    @Test
    void F2_AC_9_zeroAndNegativeAndMissingQuantityNameTheField() throws Exception {
        for (String q : new String[]{"0", "-1", null}) {
            reserve(1, body(line(1, q))).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message", containsString("quantity")));
        }
    }

    @Test
    void F2_EC_1_quantityAboveIntRangeIs400Not409() throws Exception {
        // 2147483648 is far above any stock; it must be 400, not an insufficient-stock 409.
        assertErrorBody(reserve(1, body(line(1, "2147483648"))).andExpect(status().isBadRequest()));
        assertErrorBody(reserve(1, body(line(1, "99999999999999999999"))).andExpect(status().isBadRequest()));
        assertStockIsSeed();
    }

    @Test
    void F2_EC_2_decimalWholeValueAndQuotedNumberAreRejected() throws Exception {
        assertErrorBody(reserve(1, body(line(1, "2.0"))).andExpect(status().isBadRequest()));
        assertErrorBody(reserve(1, body(line(1, "\"2\""))).andExpect(status().isBadRequest()));
        assertStockIsSeed();
        assertNoReservations(1);
    }

    @Test
    void F2_EC_3_badQuantityOnOneOfTwoSamePartLinesFailsWholeRequest() throws Exception {
        assertErrorBody(reserve(1, body(line(3, 2), line(3, 0))).andExpect(status().isBadRequest()));
        assertErrorBody(reserve(1, body(line(3, 2), line(3, "1.5"))).andExpect(status().isBadRequest()));
        assertStockIsSeed();
        assertNoReservations(1);
    }

    @Test
    void ADR002_EC_3_failedRequestAppliesNoLine() throws Exception {
        reserve(1, body(line(3, 2), line(3, -1))).andExpect(status().isBadRequest());
        assertStockIsSeed();
        assertNoReservations(1);
    }

    @Test
    void ADR005_EC_3_badQuantityOnDuplicateLineFailsWholeRequest() throws Exception {
        reserve(1, body(line(2, 1), line(2, "\"1\""))).andExpect(status().isBadRequest());
        assertStockIsSeed();
    }

    // ---------- AC-10 ----------

    @Test
    void F2_AC_10_emptyLinesListIsRejectedWith400() throws Exception {
        assertErrorBody(reserve(1, "{\"lines\":[]}").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("lines"))));
        assertStockIsSeed();
    }

    @Test
    void F2_AC_10_missingLinesFieldIsRejectedWith400() throws Exception {
        assertErrorBody(reserve(1, "{}").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("lines"))));
        assertErrorBody(reserve(1, "{\"lines\":null}").andExpect(status().isBadRequest()));
    }

    @Test
    void F2_AC_10_lineWithoutPartIsRejectedWith400() throws Exception {
        assertErrorBody(reserve(1, body(line(null, 2))).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("partId"))));
        assertErrorBody(reserve(1, body("{\"partId\":null,\"quantity\":2}")).andExpect(status().isBadRequest()));
        assertStockIsSeed();
    }

    @Test
    void F2_AC_10_malformedBodyGivesMalformedRequestBodyMessage() throws Exception {
        reserve(1, "{\"lines\": [").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Malformed request body"));
        reserve(1, "not json at all").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Malformed request body"));
        assertStockIsSeed();
    }

    @Test
    void F2_AC_10_missingBodyIsRejectedWith400() throws Exception {
        assertErrorBody(mvc.perform(post("/api/jobs/1/reservations").contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest()));
        assertStockIsSeed();
    }

    @Test
    void F2_AC_10_partIdThatIsNotAWholeNumberIsRejectedWith400() throws Exception {
        assertErrorBody(reserve(1, body(line("\"abc\"", 1))).andExpect(status().isBadRequest()));
        assertStockIsSeed();
    }

    @Test
    void ADR004_AC_10_invalidShapesAreApiErrors() throws Exception {
        assertErrorBody(reserve(1, "{\"lines\":[]}").andExpect(status().isBadRequest()));
        assertErrorBody(reserve(1, "{").andExpect(status().isBadRequest()));
        assertErrorBody(reserve(1, body(line(null, 2))).andExpect(status().isBadRequest()));
    }

    // ---------- AC-11 ----------

    @Test
    void F2_AC_11_unknownJobIsRejectedWith404NamingTheJob() throws Exception {
        assertErrorBody(reserve(UNKNOWN_JOB, body(line(1, 1))).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message", containsString(String.valueOf(UNKNOWN_JOB)))));
        assertStockIsSeed();
    }

    @Test
    void ADR004_AC_11_unknownJobIsApiError404() throws Exception {
        assertErrorBody(reserve(UNKNOWN_JOB, body(line(1, 1))).andExpect(status().isNotFound()));
    }

    // ---------- AC-12 ----------

    @Test
    void F2_AC_12_unknownPartIs404AndValidLineIsNotApplied() throws Exception {
        assertErrorBody(reserve(1, body(line(1, 2), line(UNKNOWN_PART, 1))).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message", containsString(String.valueOf(UNKNOWN_PART)))));
        assertStockIsSeed();
        assertNoReservations(1);
    }

    @Test
    void ADR002_AC_12_unknownPartLeavesNothingApplied() throws Exception {
        reserve(1, body(line(1, 2), line(UNKNOWN_PART, 1))).andExpect(status().isNotFound());
        assertStockIsSeed();
        assertNoReservations(1);
    }

    // ---------- AC-13 ----------

    @Test
    void F2_AC_13_completedJobIsRejectedWith409() throws Exception {
        long id = newJob(JobStatus.COMPLETED);
        assertErrorBody(reserve(id, body(line(1, 1))).andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString(String.valueOf(id))))
                .andExpect(jsonPath("$.message", containsString("COMPLETED"))));
        assertStockIsSeed();
        assertNoReservations(id);
    }

    @Test
    void F2_AC_13_cancelledJobIsRejectedWith409() throws Exception {
        long id = newJob(JobStatus.CANCELLED);
        assertErrorBody(reserve(id, body(line(1, 1))).andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString(String.valueOf(id))))
                .andExpect(jsonPath("$.message", containsString("CANCELLED"))));
        assertStockIsSeed();
        assertNoReservations(id);
    }

    @Test
    void ADR004_AC_13_nonScheduledJobIsApiError409() throws Exception {
        long id = newJob(JobStatus.COMPLETED);
        assertErrorBody(reserve(id, body(line(1, 1))).andExpect(status().isConflict()));
    }

    // ---------- AC-14 (FR-12 precedence) ----------

    @Test
    void F2_AC_14_unknownJobAndInvalidQuantityGives400() throws Exception {
        assertErrorBody(reserve(UNKNOWN_JOB, body(line(1, 0))).andExpect(status().isBadRequest()));
        assertStockIsSeed();
    }

    @Test
    void F2_AC_14_unknownPartAndNonScheduledJobGives404() throws Exception {
        long id = newJob(JobStatus.COMPLETED);
        assertErrorBody(reserve(id, body(line(UNKNOWN_PART, 1))).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message", containsString(String.valueOf(UNKNOWN_PART)))));
        assertStockIsSeed();
    }

    @Test
    void F2_AC_14_nonScheduledJobAndInsufficientStockGives409AboutTheJobStatus() throws Exception {
        long id = newJob(JobStatus.CANCELLED);
        assertErrorBody(reserve(id, body(line(4, 100))).andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString(String.valueOf(id))))
                .andExpect(jsonPath("$.message", containsString("CANCELLED"))));
        assertStockIsSeed();
    }

    @Test
    void F2_AC_14_unknownJobAndUnknownPartGives404NamingTheJob() throws Exception {
        assertErrorBody(reserve(UNKNOWN_JOB, body(line(UNKNOWN_PART, 1))).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message", containsString(String.valueOf(UNKNOWN_JOB)))));
    }

    @Test
    void ADR002_AC_14_precedenceMatchesCheckOrder() throws Exception {
        long done = newJob(JobStatus.COMPLETED);
        reserve(UNKNOWN_JOB, body(line(1, 0))).andExpect(status().isBadRequest());
        reserve(done, body(line(UNKNOWN_PART, 1))).andExpect(status().isNotFound());
        reserve(done, body(line(4, 100))).andExpect(status().isConflict());
        assertStockIsSeed();
    }

    @Test
    void ADR004_AC_14_precedenceStatusesAreApiErrors() throws Exception {
        long done = newJob(JobStatus.COMPLETED);
        assertErrorBody(reserve(UNKNOWN_JOB, body(line(1, 0))).andExpect(status().isBadRequest()));
        assertErrorBody(reserve(done, body(line(UNKNOWN_PART, 1))).andExpect(status().isNotFound()));
        assertErrorBody(reserve(done, body(line(4, 100))).andExpect(status().isConflict()));
    }

    // ---------- EC-4 / EC-5 ----------

    @Test
    void F2_EC_4_partWithZeroAvailableGives409AndNoChange() throws Exception {
        assertErrorBody(reserve(1, body(line(5, 1))).andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("5"))));
        assertStockIsSeed();
        assertNoReservations(1);
    }

    @Test
    void F2_EC_5_unknownPartBeatsInsufficientStock() throws Exception {
        assertErrorBody(reserve(1, body(line(UNKNOWN_PART, 1), line(4, 100))).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message", containsString(String.valueOf(UNKNOWN_PART)))));
        assertErrorBody(reserve(1, body(line(4, 100), line(UNKNOWN_PART, 1))).andExpect(status().isNotFound()));
        assertStockIsSeed();
        assertNoReservations(1);
    }

    @Test
    void ADR002_EC_5_unknownPartWithShortPartChangesNothing() throws Exception {
        reserve(1, body(line(4, 100), line(UNKNOWN_PART, 1), line(1, 1))).andExpect(status().isNotFound());
        assertStockIsSeed();
        assertNoReservations(1);
    }

    // ---------- EC-9 ----------

    @Test
    void F2_EC_9_nonNumericJobIdOnReserveGives400() throws Exception {
        assertErrorBody(reserve("abc", body(line(1, 1))).andExpect(status().isBadRequest()));
        assertStockIsSeed();
    }

    @Test
    void F2_EC_9_nonNumericJobIdOnReadGives400() throws Exception {
        assertErrorBody(mvc.perform(get("/api/jobs/abc/reservations")).andExpect(status().isBadRequest()));
    }

    @Test
    void ADR004_EC_9_nonNumericJobIdIsApiError400() throws Exception {
        assertErrorBody(reserve("abc", body(line(1, 1))).andExpect(status().isBadRequest()));
    }

    // ---------- AC-15 ----------

    private String calendarSnapshot() throws Exception {
        StringBuilder sb = new StringBuilder();
        for (int tech = 1; tech <= 3; tech++) {
            sb.append(mvc.perform(get("/api/technicians/" + tech + "/jobs")).andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString()).append('|');
        }
        return sb.toString();
    }

    @Test
    void F2_AC_15_grantedAndRejectedReservationsLeaveJobsUnchanged() throws Exception {
        String before = calendarSnapshot();
        int jobCount = store.getAllJobs().size();
        Job j1 = store.getAllJobs().stream().filter(j -> j.getId() == 1L).findFirst().orElseThrow();
        Long tech = j1.getTechnicianId();
        LocalDateTime start = j1.getStartTime();
        LocalDateTime end = j1.getEndTime();
        JobStatus st = j1.getStatus();

        reserve(1, body(line(1, 2))).andExpect(status().isCreated());
        reserve(1, body(line(4, 100))).andExpect(status().isConflict());
        reserve(1, body(line(1, 0))).andExpect(status().isBadRequest());
        reserve(1, body(line(UNKNOWN_PART, 1))).andExpect(status().isNotFound());
        reserve(UNKNOWN_JOB, body(line(1, 1))).andExpect(status().isNotFound());

        assertEquals(before, calendarSnapshot(), "the technician calendar JSON must be unchanged");
        assertEquals(jobCount, store.getAllJobs().size(), "job count must be unchanged");
        Job after = store.getAllJobs().stream().filter(j -> j.getId() == 1L).findFirst().orElseThrow();
        assertEquals(tech, after.getTechnicianId());
        assertEquals(start, after.getStartTime());
        assertEquals(end, after.getEndTime());
        assertEquals(st, after.getStatus());
    }

    @Test
    void ADR003_AC_15_jobFieldsAndCountUnchanged() throws Exception {
        String before = calendarSnapshot();
        int jobCount = store.getAllJobs().size();
        reserve(2, body(line(2, 5))).andExpect(status().isCreated());
        reserve(2, body(line(5, 1))).andExpect(status().isConflict());
        assertEquals(before, calendarSnapshot());
        assertEquals(jobCount, store.getAllJobs().size());
    }

    // ---------- AC-21 ----------

    @Test
    void F2_AC_21_reservationsFromTwoRequestsAreReturnedAggregatedPerPart() throws Exception {
        reserve(1, body(line(1, 2), line(2, 1))).andExpect(status().isCreated());
        reserve(1, body(line(1, 4))).andExpect(status().isCreated());
        mvc.perform(get("/api/jobs/1/reservations")).andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].partId").value(1))
                .andExpect(jsonPath("$[0].quantity").value(6))
                .andExpect(jsonPath("$[1].partId").value(2))
                .andExpect(jsonPath("$[1].quantity").value(1));
    }

    @Test
    void F2_AC_21_jobWithNoReservationsReturnsEmptyList() throws Exception {
        mvc.perform(get("/api/jobs/2/reservations")).andExpect(status().isOk())
                .andExpect(jsonPath("$", empty()));
    }

    @Test
    void F2_AC_21_reservationsAreKeptPerJob() throws Exception {
        reserve(1, body(line(1, 2))).andExpect(status().isCreated());
        mvc.perform(get("/api/jobs/2/reservations")).andExpect(status().isOk())
                .andExpect(jsonPath("$", empty()));
    }

    @Test
    void F2_AC_21_unknownJobReadGives404() throws Exception {
        assertErrorBody(mvc.perform(get("/api/jobs/" + UNKNOWN_JOB + "/reservations"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message", containsString(String.valueOf(UNKNOWN_JOB)))));
    }

    @Test
    void ADR003_AC_21_readReturnsAggregatedPairsEmptyListAnd404() throws Exception {
        reserve(1, body(line(3, 1), line(3, 1))).andExpect(status().isCreated());
        mvc.perform(get("/api/jobs/1/reservations")).andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].partId").value(3))
                .andExpect(jsonPath("$[0].quantity").value(2));
        mvc.perform(get("/api/jobs/3/reservations")).andExpect(status().isOk())
                .andExpect(jsonPath("$", empty()));
        mvc.perform(get("/api/jobs/" + UNKNOWN_JOB + "/reservations")).andExpect(status().isNotFound());
    }
}
