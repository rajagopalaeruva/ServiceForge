package com.serviceforge.controller;

import com.serviceforge.dto.ApiError;
import com.serviceforge.exception.ConflictException;
import com.serviceforge.exception.NotFoundException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.Comparator;
import java.util.stream.Collectors;

/**
 * Shared mapping of failures to an {@link ApiError} body: request-level failures to HTTP 400, and
 * {@link NotFoundException} / {@link ConflictException} to 404 / 409.
 *
 * See pipeline/bugs/bug-003-validation-error-contract.md (approved Option A) and
 * pipeline/decisions/adr/ADR-004-map-errors-to-apierror-in-one-place.md.
 *
 * Scope: bean-validation failures, unreadable or malformed request bodies (including
 * unparseable values), and path/query values of the wrong type; plus the two exception types above.
 * It does not change the 404 and 409 mappings that the Feature 1 controllers make themselves.
 * Messages name the field or parameter and never include exception class names, stack traces or the rejected value.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    static final String MALFORMED_BODY_MESSAGE = "Malformed request body";
    static final String NOT_FOUND_MESSAGE = "Not found";
    static final String CONFLICT_MESSAGE = "Request conflicts with the current state";

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldErrors().stream()
                .sorted(Comparator.comparing(error -> error.getField()))
                .map(error -> error.getField() + ": " + error.getDefaultMessage())
                .collect(Collectors.joining("; "));
        if (message.isEmpty()) {
            message = "Invalid request";
        }
        return ResponseEntity.badRequest().body(new ApiError(message));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiError> handleUnreadableBody(HttpMessageNotReadableException e) {
        return ResponseEntity.badRequest().body(new ApiError(MALFORMED_BODY_MESSAGE));
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiError> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return ResponseEntity.badRequest().body(new ApiError("Invalid value for parameter '" + e.getName() + "'"));
    }

    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<ApiError> handleNotFound(NotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ApiError(messageOr(e, NOT_FOUND_MESSAGE)));
    }

    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<ApiError> handleConflict(ConflictException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(new ApiError(messageOr(e, CONFLICT_MESSAGE)));
    }

    private static String messageOr(RuntimeException e, String fallback) {
        String message = e.getMessage();
        return message == null || message.isBlank() ? fallback : message;
    }}


