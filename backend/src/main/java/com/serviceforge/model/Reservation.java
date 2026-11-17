package com.serviceforge.model;

/**
 * The quantity of one part reserved against a job, summed over all successful reservations
 * (FR-8, FR-17). Immutable snapshot; the stored quantities live in MockDataStore (ADR-003).
 */
public final class Reservation {

    private final Long partId;
    private final int quantity;

    public Reservation(Long partId, int quantity) {
        this.partId = partId;
        this.quantity = quantity;
    }

    public Long getPartId() {
        return partId;
    }

    public int getQuantity() {
        return quantity;
    }
}