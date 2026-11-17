package com.serviceforge.service;

import com.serviceforge.data.MockDataStore;
import com.serviceforge.dto.ReservationLineRequest;
import com.serviceforge.dto.ReserveRequest;
import com.serviceforge.exception.ConflictException;
import com.serviceforge.exception.NotFoundException;
import com.serviceforge.model.Job;
import com.serviceforge.model.JobStatus;
import com.serviceforge.model.Part;
import com.serviceforge.model.Reservation;
import com.serviceforge.model.ReservationResult;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.locks.ReentrantLock;

/**
 * The one component through which parts stock and reservations are read (and, from T-4, changed).
 * It holds the single lock from ADR-001; every operation on that state runs under it, so a read
 * never sees a half-applied request. The lock is private: no controller or other class takes it,
 * and the store's collections are never handed out (ADR-003). Safe for a single instance only (A-2).
 */
@Service
public class PartsReservationService {

    private final MockDataStore store;
    private final ReentrantLock lock = new ReentrantLock();

    public PartsReservationService(MockDataStore store) {
        this.store = store;
    }

    /** FR-2: every part with its current available quantity, in ascending part id order. */
    public List<Part> listStock() {
        lock.lock();
        try {
            return store.partsSnapshot();
        } finally {
            lock.unlock();
        }
    }

    /**
     * Reserves parts for a job (FR-4, FR-6 to FR-10, FR-12 to FR-14). Everything runs under the one
     * lock. All checks run in FR-12 order and change nothing; only then is the request applied in one
     * step (ADR-002). The job itself is never changed (FR-13).
     *
     * @throws IllegalArgumentException if the request is structurally invalid (400, defensive check)
     * @throws NotFoundException        if the job, then a part (ascending id), is unknown
     * @throws ConflictException        if the job is not SCHEDULED, then if a part is short
     */
    public ReservationResult reserve(Long jobId, ReserveRequest request) {
        lock.lock();
        try {
            // 1. Invalid request.
            if (request == null || request.getLines() == null || request.getLines().isEmpty()) {
                throw new IllegalArgumentException("lines must not be empty");
            }
            for (ReservationLineRequest line : request.getLines()) {
                if (line == null || line.getPartId() == null) {
                    throw new IllegalArgumentException("partId must not be null");
                }
                if (line.getQuantity() == null || line.getQuantity() <= 0) {
                    throw new IllegalArgumentException("quantity must be a positive whole number");
                }
            }
            // 2. Unknown job.
            Job job = jobId == null ? null : store.findJob(jobId).orElse(null);
            if (job == null) {
                throw new NotFoundException("Job " + jobId + " not found");
            }
            // 3. Aggregate per part (FR-6); unknown part, lowest id first.
            Map<Long, Integer> totals = new TreeMap<>();
            for (ReservationLineRequest line : request.getLines()) {
                totals.merge(line.getPartId(), line.getQuantity(), (a, b) -> {
                    long sum = (long) a + b;
                    return sum > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) sum;
                });
            }
            for (Long partId : totals.keySet()) {
                if (!store.partExists(partId)) {
                    throw new NotFoundException("Part " + partId + " not found");
                }
            }
            // 4. Job status.
            if (job.getStatus() != JobStatus.SCHEDULED) {
                throw new ConflictException("Job " + jobId + " is " + job.getStatus()
                        + " and cannot take reservations");
            }
            // 5. Stock; first short part by ascending id.
            for (Map.Entry<Long, Integer> e : totals.entrySet()) {
                int available = store.availableOf(e.getKey());
                if (e.getValue() > available) {
                    throw new ConflictException("Insufficient stock for part " + e.getKey()
                            + ": requested " + e.getValue() + ", available " + available);
                }
            }
            // 6. Apply.
            store.applyReservation(jobId, totals);
            List<Reservation> reserved = new ArrayList<>();
            totals.forEach((partId, qty) -> reserved.add(new Reservation(partId, qty)));
            return new ReservationResult(jobId, reserved);
        } finally {
            lock.unlock();
        }
    }

    /**
     * FR-17: the reservations recorded against a job, summed per part, in ascending part id order.
     * Empty when the job has none.
     *
     * @throws NotFoundException if no job has this id
     */
    public List<Reservation> getJobReservations(Long jobId) {
        lock.lock();
        try {
            if (jobId == null || store.findJob(jobId).isEmpty()) {
                throw new NotFoundException("Job " + jobId + " not found");
            }
            return store.reservationsSnapshot(jobId);
        } finally {
            lock.unlock();
        }
    }
}