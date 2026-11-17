package com.serviceforge.controller;

import com.serviceforge.exception.ConflictException;
import com.serviceforge.exception.NotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Developer's own unit test for T-2 (Feature 2, ADR-004). Tagged F2U_ADR004_, so it is not an
 * independent test. A probe controller throws each exception type; the shared ApiExceptionHandler
 * must map it to its status with an ApiError body.
 */
class ApiExceptionHandlerNotFoundConflictTest {

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new ProbeController())
                .setControllerAdvice(new ApiExceptionHandler())
                .build();
    }

    @RestController
    static class ProbeController {
        @GetMapping("/probe/not-found")
        String notFound() {
            throw new NotFoundException("Job 99 not found");
        }

        @GetMapping("/probe/conflict")
        String conflict() {
            throw new ConflictException("Job 2 is COMPLETED");
        }

        @GetMapping("/probe/not-found-blank")
        String notFoundBlank() {
            throw new NotFoundException(null);
        }

        @GetMapping("/probe/conflict-blank")
        String conflictBlank() {
            throw new ConflictException(" ");
        }

        @GetMapping("/probe/illegal-argument")
        String illegalArgument() {
            throw new IllegalArgumentException("boom");
        }
    }

    @Test
    void F2U_ADR004_notFoundExceptionMapsTo404WithApiError() throws Exception {
        mvc.perform(get("/probe/not-found"))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.message").value("Job 99 not found"));
    }

    @Test
    void F2U_ADR004_conflictExceptionMapsTo409WithApiError() throws Exception {
        mvc.perform(get("/probe/conflict"))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.message").value("Job 2 is COMPLETED"));
    }

    @Test
    void F2U_ADR004_blankMessageFallsBackToGenericNonEmptyMessage() throws Exception {
        mvc.perform(get("/probe/not-found-blank"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value(ApiExceptionHandler.NOT_FOUND_MESSAGE));
        mvc.perform(get("/probe/conflict-blank"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(ApiExceptionHandler.CONFLICT_MESSAGE));
    }

    @Test
    void F2U_ADR004_messagesNeverContainClassNames() throws Exception {
        mvc.perform(get("/probe/not-found"))
                .andExpect(jsonPath("$.message", not(containsString("Exception"))))
                .andExpect(jsonPath("$.message", not(containsString("com.serviceforge"))));
    }

    @Test
    void F2U_ADR004_typesAreDistinctFromIllegalArgumentAndState() {
        org.junit.jupiter.api.Assertions.assertFalse(IllegalArgumentException.class.isAssignableFrom(NotFoundException.class));
        org.junit.jupiter.api.Assertions.assertFalse(IllegalStateException.class.isAssignableFrom(ConflictException.class));
    }
}
