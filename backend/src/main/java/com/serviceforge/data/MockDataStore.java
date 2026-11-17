package com.serviceforge.data;

import com.serviceforge.model.Job;
import com.serviceforge.model.JobStatus;
import com.serviceforge.model.Part;
import com.serviceforge.model.Reservation;
import com.serviceforge.model.Technician;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

/**
 * In-memory mock data store. There is no real database in this repo (see AGENTS.md) —
 * everything here resets on restart, which is expected for a training boilerplate.
 */
@Component
public class MockDataStore {

    private final List<Technician> technicians = new ArrayList<>();
    private final List<Job> jobs = new ArrayList<>();
    private final AtomicLong jobIdSequence = new AtomicLong(1);

    // Feature 2 state (ADR-003). Not thread-safe: reach it only through PartsReservationService,
    // which holds the lock (ADR-001). The collections are never returned; callers get copies.
    private final Map<Long, String> partNames = new TreeMap<>();
    private final Map<Long, Integer> partAvailable = new TreeMap<>();
    private final Map<Long, Map<Long, Integer>> reservedByJob = new HashMap<>();

    @PostConstruct
    public void seed() {
        seedParts();

        technicians.add(new Technician(1L, "Jordan Reyes", "North"));
        technicians.add(new Technician(2L, "Priya Nair", "South"));
        technicians.add(new Technician(3L, "Sam Okafor", "East"));

        // Seed a couple of non-overlapping jobs so the calendar isn't empty on first run.
        jobs.add(new Job(nextJobId(), 1L, "Acme Corp",
                LocalDateTime.now().withHour(9).withMinute(0).withSecond(0).withNano(0),
                LocalDateTime.now().withHour(11).withMinute(0).withSecond(0).withNano(0),
                JobStatus.SCHEDULED));
        jobs.add(new Job(nextJobId(), 1L, "Northwind Traders",
                LocalDateTime.now().withHour(14).withMinute(0).withSecond(0).withNano(0),
                LocalDateTime.now().withHour(15).withMinute(30).withSecond(0).withNano(0),
                JobStatus.SCHEDULED));
        jobs.add(new Job(nextJobId(), 2L, "Globex", LocalDateTime.now().withHour(10).withMinute(0).withSecond(0).withNano(0),
                LocalDateTime.now().withHour(12).withMinute(0).withSecond(0).withNano(0),
                JobStatus.SCHEDULED));
    }

    /** Parts catalogue per A-1 (FR-1, NFR-9); deterministic at every start. */
    private void seedParts() {
        addPart(1L, "Capacitor 40\u00b5F", 12);
        addPart(2L, "Air filter", 25);
        addPart(3L, "Contactor relay", 6);
        addPart(4L, "Thermostat", 3);
        addPart(5L, "Refrigerant valve", 0);
    }

    private void addPart(Long id, String name, int available) {
        partNames.put(id, name);
        partAvailable.put(id, available);
    }

    /** A copy of the catalogue in ascending part id order. For use under the service lock. */
    public List<Part> partsSnapshot() {
        List<Part> result = new ArrayList<>();
        for (Map.Entry<Long, String> e : partNames.entrySet()) {
            result.add(new Part(e.getKey(), e.getValue(), partAvailable.get(e.getKey())));
        }
        return result;
    }

    /** A copy of a job's reserved quantities per part, ascending part id. For use under the service lock. */
    public List<Reservation> reservationsSnapshot(Long jobId) {
        List<Reservation> result = new ArrayList<>();
        Map<Long, Integer> reserved = reservedByJob.get(jobId);
        if (reserved != null) {
            new TreeMap<>(reserved).forEach((partId, qty) -> result.add(new Reservation(partId, qty)));
        }
        return result;
    }

    /** Whether a part with this id is in the catalogue. For use under the service lock. */
    public boolean partExists(Long partId) {
        return partId != null && partNames.containsKey(partId);
    }

    /** The quantity available of a part, or 0 if the part is unknown. For use under the service lock. */
    public int availableOf(Long partId) {
        Integer available = partId == null ? null : partAvailable.get(partId);
        return available == null ? 0 : available;
    }

    /**
     * Applies an already validated reservation in one step: reduces each part's availability and
     * adds the quantities to the job's reserved totals. The caller must have checked that every part
     * exists and every total fits; this method re-checks and changes nothing if any does not.
     * Service lock only (ADR-001); the one mutator of Feature 2 stock.
     */
    public void applyReservation(Long jobId, Map<Long, Integer> totals) {
        for (Map.Entry<Long, Integer> e : totals.entrySet()) {
            Integer available = partAvailable.get(e.getKey());
            if (available == null || e.getValue() == null || e.getValue() <= 0 || e.getValue() > available) {
                throw new IllegalStateException("Reservation could not be applied");
            }
        }
        Map<Long, Integer> reserved = reservedByJob.computeIfAbsent(jobId, id -> new TreeMap<>());
        for (Map.Entry<Long, Integer> e : totals.entrySet()) {
            partAvailable.merge(e.getKey(), -e.getValue(), Integer::sum);
            reserved.merge(e.getKey(), e.getValue(), Integer::sum);
        }
    }

    public Optional<Job> findJob(Long id) {
        return jobs.stream().filter(j -> j.getId().equals(id)).findFirst();
    }

    public List<Technician> getAllTechnicians() {
        return Collections.unmodifiableList(technicians);
    }

    public Optional<Technician> findTechnician(Long id) {
        return technicians.stream().filter(t -> t.getId().equals(id)).findFirst();
    }

    public List<Job> getJobsForTechnician(Long technicianId) {
        return jobs.stream()
                .filter(j -> j.getTechnicianId().equals(technicianId))
                .collect(Collectors.toList());
    }

    public List<Job> getAllJobs() {
        return Collections.unmodifiableList(jobs);
    }

    public Job save(Job job) {
        jobs.add(job);
        return job;
    }

    public Long nextJobId() {
        return jobIdSequence.getAndIncrement();
    }
}
