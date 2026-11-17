package com.serviceforge.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/** Body of {@code POST /api/jobs/{jobId}/reservations}: one or more lines (FR-3, FR-5, NFR-7). */
public class ReserveRequest {

    @NotEmpty
    private List<@NotNull @Valid ReservationLineRequest> lines;

    public List<ReservationLineRequest> getLines() {
        return lines;
    }

    public void setLines(List<ReservationLineRequest> lines) {
        this.lines = lines;
    }
}
