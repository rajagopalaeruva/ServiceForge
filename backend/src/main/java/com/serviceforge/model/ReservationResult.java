package com.serviceforge.model;

import java.util.List;

/**
 * The outcome of one granted reservation request (FR-10): the job and the quantity reserved per
 * part by this request only, in ascending part id order. Immutable (ADR-003).
 */
public final class ReservationResult {

    private final Long jobId;
    private final List<Reservation> reserved;

    public ReservationResult(Long jobId, List<Reservation> reserved) {
        this.jobId = jobId;
        this.reserved = List.copyOf(reserved);
    }

    public Long getJobId() {
        return jobId;
    }

    public List<Reservation> getReserved() {
        return reserved;
    }
}
