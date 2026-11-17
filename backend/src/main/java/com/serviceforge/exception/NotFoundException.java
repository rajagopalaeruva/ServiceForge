package com.serviceforge.exception;

/**
 * Signals that a requested resource does not exist. Mapped centrally to 404 with an ApiError body
 * by ApiExceptionHandler (ADR-004, pipeline/rules/api-error-contract.md). The message is returned
 * to the client, so it names the unknown id and nothing internal.
 */
public class NotFoundException extends RuntimeException {

    public NotFoundException(String message) {
        super(message);
    }
}
