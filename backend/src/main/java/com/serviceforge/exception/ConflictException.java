package com.serviceforge.exception;

/**
 * Signals that a request conflicts with the current state (for example a job that is not
 * SCHEDULED, or insufficient stock). Mapped centrally to 409 with an ApiError body by
 * ApiExceptionHandler (ADR-004, pipeline/rules/api-error-contract.md). The message is returned to
 * the client, so it names the ids and quantities involved and nothing internal.
 */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
