package com.serviceforge.dto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.ResponseEntity;
import com.serviceforge.controller.ApiExceptionHandler;
import jakarta.validation.Valid;

import java.util.Set;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T-3 unit tests at request-type level: deserialise the JSON with the Spring Boot ObjectMapper, then
 * validate (FR-3, FR-5, NFR-7, ADR-005). One standalone MockMvc test shows the failure reaches the
 * shared ApiError mapping as 400 (ADR-004).
 */
@JsonTest
class ReserveRequestTest {

    private static final Validator VALIDATOR = Validation.buildDefaultValidatorFactory().getValidator();

    @Autowired
    private ObjectMapper objectMapper;

    private static String body(String quantityJson) {
        return "{\"lines\":[{\"partId\":1,\"quantity\":" + quantityJson + "}]}";
    }

    private ReserveRequest read(String json) throws Exception {
        return objectMapper.readValue(json, ReserveRequest.class);
    }

    private Set<ConstraintViolation<ReserveRequest>> validate(String json) throws Exception {
        return VALIDATOR.validate(read(json));
    }

    private void assertUnreadable(String json) {
        assertThrows(JsonMappingException.class, () -> read(json), json);
    }

    private void assertInvalid(String json) throws Exception {
        assertTrue(!validate(json).isEmpty(), "expected a validation failure for " + json);
    }

    @Test
    void F2U_FR_3_validRequestWithTwoLinesIsReadAndPasses() throws Exception {
        String json = "{\"lines\":[{\"partId\":1,\"quantity\":2},{\"partId\":3,\"quantity\":5}]}";
        ReserveRequest request = read(json);

        assertTrue(VALIDATOR.validate(request).isEmpty());
        assertEquals(2, request.getLines().size());
        assertEquals(Long.valueOf(3), request.getLines().get(1).getPartId());
        assertEquals(Integer.valueOf(5), request.getLines().get(1).getQuantity());
    }

    @Test
    void F2U_AC_9_quantityOneAndMaxIntAreAccepted() throws Exception {
        assertTrue(validate(body("1")).isEmpty());
        assertTrue(validate(body("2147483647")).isEmpty());
    }

    @Test
    void F2U_AC_9_zeroAndNegativeQuantityFailValidation() throws Exception {
        assertInvalid(body("0"));
        assertInvalid(body("-1"));
    }

    @Test
    void F2U_AC_9_missingOrNullQuantityFailsValidation() throws Exception {
        assertInvalid("{\"lines\":[{\"partId\":1}]}");
        assertInvalid(body("null"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"1.5", "2.0", "2.00", "2e0", "\"2\"", "\"abc\"", "true", "[2]", "{}"})
    void F2U_AC_9_nonWholeNumberJsonValueIsRejectedWhenRead(String quantityJson) {
        assertUnreadable(body(quantityJson));
    }

    @Test
    void F2U_ADR005_decimalTwoPointZeroIsRejectedWhereDefaultJacksonWouldAcceptIt() throws Exception {
        assertUnreadable(body("2.0"));
    }

    @Test
    void F2U_ADR005_quotedTwoIsRejectedWhereDefaultJacksonWouldAcceptIt() throws Exception {
        assertUnreadable(body("\"2\""));
    }

    @Test
    void F2U_ADR005_strictnessAppliesToQuantityOnly_otherMapperSettingsAreUnchanged() throws Exception {
        // The shared ObjectMapper still coerces 2.0 for an unrelated plain field (NFR-8).
        Plain plain = objectMapper.readValue("{\"quantity\":2.0}", Plain.class);
        assertEquals(Integer.valueOf(2), plain.quantity);
    }

    @ParameterizedTest
    @ValueSource(strings = {"2147483648", "-2147483649", "99999999999999999999"})
    void F2U_EC_1_quantityOutsideIntegerRangeIsRejectedWhenRead(String quantityJson) {
        assertUnreadable(body(quantityJson));
    }

    @Test
    void F2U_EC_2_decimalAndQuotedWholeNumbersAreRejected() {
        assertUnreadable(body("2.0"));
        assertUnreadable(body("\"2\""));
    }

    @Test
    void F2U_EC_3_samePartTwiceWithOneInvalidQuantityFailsTheWholeRequest() throws Exception {
        assertInvalid("{\"lines\":[{\"partId\":1,\"quantity\":2},{\"partId\":1,\"quantity\":0}]}");
        assertUnreadable("{\"lines\":[{\"partId\":1,\"quantity\":2},{\"partId\":1,\"quantity\":2.0}]}");
    }

    @Test
    void F2U_AC_10_missingNullOrEmptyLinesFailValidation() throws Exception {
        assertInvalid("{}");
        assertInvalid("{\"lines\":null}");
        assertInvalid("{\"lines\":[]}");
    }

    @Test
    void F2U_AC_10_lineWithoutPartOrNullLineFailsValidation() throws Exception {
        assertInvalid("{\"lines\":[{\"quantity\":1}]}");
        assertInvalid("{\"lines\":[{\"partId\":null,\"quantity\":1}]}");
        assertInvalid("{\"lines\":[null]}");
    }

    @Test
    void F2U_AC_10_malformedBodyIsRejectedWhenRead() {
        assertUnreadable("{\"lines\":[");
        assertUnreadable("{\"lines\":\"x\"}");
    }

    @Test
    void F2U_NFR_7_failedFieldChecksNameTheField() throws Exception {
        Set<ConstraintViolation<ReserveRequest>> violations = validate(body("0"));
        assertTrue(violations.stream().anyMatch(v -> v.getPropertyPath().toString().contains("quantity")));
        Set<ConstraintViolation<ReserveRequest>> noLines = validate("{\"lines\":[]}");
        assertTrue(noLines.stream().anyMatch(v -> v.getPropertyPath().toString().equals("lines")));
    }

    static class Plain {
        public Integer quantity;
    }

    @RestController
    static class Probe {
        @PostMapping("/probe")
        ResponseEntity<Void> post(@Valid @RequestBody ReserveRequest request) {
            return ResponseEntity.noContent().build();
        }
    }

    private MockMvc mvc() {
        return MockMvcBuilders.standaloneSetup(new Probe())
                .setControllerAdvice(new ApiExceptionHandler())
                .build();
    }

    @Test
    void F2U_ADR004_strictQuantityFailureGives400ApiErrorWithoutRejectedValue() throws Exception {
        mvc().perform(post("/probe").contentType(MediaType.APPLICATION_JSON).content(body("2.0")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Malformed request body"))
                .andExpect(jsonPath("$.message", not(containsString("2.0"))));
    }

    @Test
    void F2U_ADR004_validationFailureGives400ApiErrorNamingTheField() throws Exception {
        mvc().perform(post("/probe").contentType(MediaType.APPLICATION_JSON).content("{\"lines\":[]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("lines")));
        mvc().perform(post("/probe").contentType(MediaType.APPLICATION_JSON).content(body("0")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("quantity")));
    }

    @Test
    void F2U_AC_10_missingBodyGives400ApiError() throws Exception {
        mvc().perform(post("/probe").contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").isNotEmpty());
    }
}
