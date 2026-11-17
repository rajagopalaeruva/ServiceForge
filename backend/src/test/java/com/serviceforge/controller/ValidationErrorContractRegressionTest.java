package com.serviceforge.controller;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.LocalDate;
import java.util.stream.Stream;

import static org.hamcrest.Matchers.allOf;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Regression for BUG-003 (pipeline/bugs/bug-003-validation-error-contract.md), approved Option A.
 * Test names carry the bug record's acceptance-criterion IDs (AC-1 to AC-7).
 *
 * Uses the full Spring context so the test exercises the real application wiring, including any
 * application-wide error handling, and not a hand-built controller.
 *
 * The 201, 404 and 409 guards (AC-6) pass before and after the fix; they protect existing behaviour.
 */
@SpringBootTest
@AutoConfigureMockMvc
class ValidationErrorContractRegressionTest {

    private static final String VALID_START = "2030-01-15T10:00:00";
    private static final String VALID_END = "2030-01-15T11:00:00";

    @Autowired
    private MockMvc mockMvc;

    // ---- AC-1 to AC-4: 400 with ApiError --------------------------------------------------------

    @Test
    void BUG003_AC1_blankCustomerNameReturns400ApiErrorNamingTheField() throws Exception {
        postJob("""
                {"technicianId": 3, "customerName": "",
                 "startTime": "%s", "endTime": "%s"}
                """.formatted(VALID_START, VALID_END))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("customerName")));
    }

    @Test
    void BUG003_AC2_missingTechnicianIdReturns400ApiErrorNamingTheField() throws Exception {
        postJob("""
                {"customerName": "Regression Customer",
                 "startTime": "%s", "endTime": "%s"}
                """.formatted(VALID_START, VALID_END))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("technicianId")));
    }

    @Test
    void BUG003_AC3_malformedJsonReturns400ApiErrorMalformedRequestBody() throws Exception {
        postJob("{\"technicianId\":3,")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Malformed request body"));
    }

    @Test
    void BUG003_AC4_unparseableDateReturns400ApiError() throws Exception {
        postJob("""
                {"technicianId": 3, "customerName": "Regression Customer",
                 "startTime": "not-a-date", "endTime": "%s"}
                """.formatted(VALID_END))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").isNotEmpty());
    }

    // ---- AC-5: non-numeric path variable --------------------------------------------------------

    @Test
    void BUG003_AC5_nonNumericTechnicianIdReturns400ApiError() throws Exception {
        mockMvc.perform(get("/api/technicians/abc"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").isNotEmpty());
    }

    // ---- AC-6: existing 201, 404 and 409 behaviour is unchanged ----------------------------------

    @Test
    void BUG003_AC6_successfulBookingStillReturns201() throws Exception {
        postJob("""
                {"technicianId": 2, "customerName": "Regression Customer",
                 "startTime": "2031-03-03T10:00:00", "endTime": "2031-03-03T11:00:00"}
                """)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.technicianId").value(2));
    }

    @Test
    void BUG003_AC6_unknownTechnicianStillReturns404ApiError() throws Exception {
        postJob("""
                {"technicianId": 9999, "customerName": "Regression Customer",
                 "startTime": "%s", "endTime": "%s"}
                """.formatted(VALID_START, VALID_END))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message", containsString("9999")));
    }

    @Test
    void BUG003_AC6_conflictingBookingStillReturns409ApiError() throws Exception {
        // Seeded job for technician 1 occupies 09:00-11:00 today (see MockDataStore.seed()).
        String today = LocalDate.now().toString();
        postJob("""
                {"technicianId": 1, "customerName": "Regression Customer",
                 "startTime": "%sT10:00:00", "endTime": "%sT12:00:00"}
                """.formatted(today, today))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("conflict")));
    }

    // ---- AC-7: no internals in any 400 body -------------------------------------------------------

    static Stream<String> badRequests() {
        return Stream.of(
                "{\"technicianId\":3,",
                "{\"technicianId\": 3, \"customerName\": \"\", \"startTime\": \"" + VALID_START
                        + "\", \"endTime\": \"" + VALID_END + "\"}",
                "{\"technicianId\": 3, \"customerName\": \"X\", \"startTime\": \"not-a-date\", \"endTime\": \""
                        + VALID_END + "\"}");
    }

    @ParameterizedTest
    @MethodSource("badRequests")
    void BUG003_AC7_badRequestBodiesContainNoInternals(String body) throws Exception {
        postJob(body)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", allOf(
                        not(containsString("Exception")),
                        not(containsString("org.springframework")),
                        not(containsString("com.fasterxml")),
                        not(containsString("com.serviceforge")),
                        not(containsString("java.")),
                        not(startsWith("at ")))));
    }

    private ResultActions postJob(String json) throws Exception {
        return mockMvc.perform(post("/api/jobs")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json));
    }
}
