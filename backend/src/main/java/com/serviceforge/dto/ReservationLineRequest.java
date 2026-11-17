package com.serviceforge.dto;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

/** One line of a reservation request: a part and a whole-number quantity (FR-3, FR-5). */
public class ReservationLineRequest {

    @NotNull
    private Long partId;

    @NotNull
    @Positive
    @JsonDeserialize(using = StrictIntegerDeserializer.class)
    private Integer quantity;

    public Long getPartId() {
        return partId;
    }

    public void setPartId(Long partId) {
        this.partId = partId;
    }

    public Integer getQuantity() {
        return quantity;
    }

    public void setQuantity(Integer quantity) {
        this.quantity = quantity;
    }
}
