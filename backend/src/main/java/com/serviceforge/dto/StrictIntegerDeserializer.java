package com.serviceforge.dto;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;

import java.io.IOException;
import java.math.BigInteger;

/**
 * Reads a JSON whole number into an Integer and nothing else (ADR-005, Option A). A decimal such as
 * 1.5 or 2.0, a quoted value such as "2", a non-numeric value, or a number outside the int range fails
 * with a mismatched-input error, which {@code ApiExceptionHandler} maps to 400. It is applied to one
 * field with {@code @JsonDeserialize}; the application-wide Jackson settings are not changed (NFR-8).
 * A JSON null never reaches this class; the field's {@code @NotNull} check handles it.
 */
public class StrictIntegerDeserializer extends JsonDeserializer<Integer> {

    private static final BigInteger MIN = BigInteger.valueOf(Integer.MIN_VALUE);
    private static final BigInteger MAX = BigInteger.valueOf(Integer.MAX_VALUE);

    @Override
    public Integer deserialize(JsonParser parser, DeserializationContext context) throws IOException {
        if (parser.currentToken() != JsonToken.VALUE_NUMBER_INT) {
            return (Integer) context.handleUnexpectedToken(Integer.class, parser);
        }
        BigInteger value = parser.getBigIntegerValue();
        if (value.compareTo(MIN) < 0 || value.compareTo(MAX) > 0) {
            return (Integer) context.handleWeirdNumberValue(Integer.class, value, "out of integer range");
        }
        return value.intValue();
    }
}
