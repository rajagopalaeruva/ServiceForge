package com.serviceforge.controller;

import com.serviceforge.dto.ReserveRequest;
import com.serviceforge.model.Part;
import com.serviceforge.model.Reservation;
import com.serviceforge.model.ReservationResult;
import com.serviceforge.service.PartsReservationService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Feature 2 endpoints (plan section 2.1): stock view, reserve parts for a job, and a job's
 * reservations. Errors are not caught here; {@link ApiExceptionHandler} maps them (ADR-004).
 */
@RestController
public class PartsController {

    private final PartsReservationService reservationService;

    public PartsController(PartsReservationService reservationService) {
        this.reservationService = reservationService;
    }

    @GetMapping("/api/parts")
    public ResponseEntity<List<Part>> listParts() {
        return ResponseEntity.ok(reservationService.listStock());
    }

    @PostMapping("/api/jobs/{jobId}/reservations")
    public ResponseEntity<ReservationResult> reserve(@PathVariable Long jobId,
                                                     @Valid @RequestBody ReserveRequest request) {
        return ResponseEntity.status(201).body(reservationService.reserve(jobId, request));
    }

    @GetMapping("/api/jobs/{jobId}/reservations")
    public ResponseEntity<List<Reservation>> getJobReservations(@PathVariable Long jobId) {
        return ResponseEntity.ok(reservationService.getJobReservations(jobId));
    }
}
