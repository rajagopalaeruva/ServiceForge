package com.serviceforge.model;

/**
 * A snapshot of one part in the catalogue: identifier, name and the quantity available at the time
 * the snapshot was taken. Immutable, so a caller holding one can never change the stored stock
 * (ADR-003). The stored quantities live in MockDataStore.
 */
public final class Part {

    private final Long id;
    private final String name;
    private final int available;

    public Part(Long id, String name, int available) {
        this.id = id;
        this.name = name;
        this.available = available;
    }

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public int getAvailable() {
        return available;
    }
}