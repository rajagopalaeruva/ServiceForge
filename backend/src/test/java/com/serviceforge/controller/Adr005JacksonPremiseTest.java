package com.serviceforge.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;

/**
 * ADR-005 Confirmation (EC-2, AC-9): records how the Jackson ObjectMapper configured by
 * Spring Boot 3.2 treats 2.0 and "2" for a plain Integer field. The premise of ADR-005 is
 * that both are accepted as 2, so a plain Integer field would wrongly accept them.
 */
@JsonTest
class Adr005JacksonPremiseTest {

    static class PlainIntegerHolder {
        public Integer quantity;
    }

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void ADR005_AC_9_EC_2_jacksonDefaultAcceptsDecimalTwoPointZeroAndQuotedTwoAsIntegerTwo() throws Exception {
        PlainIntegerHolder decimal = objectMapper.readValue("{\"quantity\":2.0}", PlainIntegerHolder.class);
        PlainIntegerHolder quoted = objectMapper.readValue("{\"quantity\":\"2\"}", PlainIntegerHolder.class);

        assertEquals(Integer.valueOf(2), decimal.quantity, "2.0 is coerced to Integer 2");
        assertEquals(Integer.valueOf(2), quoted.quantity, "\"2\" is coerced to Integer 2");
    }
}
