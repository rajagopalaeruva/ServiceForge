package com.serviceforge.service;

import com.serviceforge.data.MockDataStore;
import com.serviceforge.dto.ReservationLineRequest;
import com.serviceforge.dto.ReserveRequest;
import com.serviceforge.exception.ConflictException;
import com.serviceforge.exception.NotFoundException;
import com.serviceforge.model.Job;
import com.serviceforge.model.JobStatus;
import com.serviceforge.model.ReservationResult;
import com.serviceforge.model.Part;
import com.serviceforge.model.Reservation;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Developer's own unit tests for T-1 (Feature 2). Tagged F2U_, so they are not independent tests.
 * They build the store and service directly, with no Spring context.
 */
class PartsReservationServiceTest {

    private MockDataStore store;
    private PartsReservationService service;

    @BeforeEach
    void setUp() {
        store = new MockDataStore();
        store.seed();
        service = new PartsReservationService(store);
    }

    private static void assertSeededCatalogue(List<Part> stock) {
        long[] ids = {1, 2, 3, 4, 5};
        String[] names = {"Capacitor 40\u00b5F", "Air filter", "Contactor relay", "Thermostat", "Refrigerant valve"};
        int[] available = {12, 25, 6, 3, 0};
        assertEquals(5, stock.size());
        for (int i = 0; i < 5; i++) {
            assertEquals(ids[i], stock.get(i).getId());
            assertEquals(names[i], stock.get(i).getName());
            assertEquals(available[i], stock.get(i).getAvailable());
        }
    }

    /** F2U_AC_1: the stock read equals the A-1 catalogue, in ascending id order. */
    @Test
    void F2U_AC_1_stockReadEqualsSeededCatalogue() {
        assertSeededCatalogue(service.listStock());
    }

    /** F2U_AC_22: a fresh instance equals A-1 and holds no reservations. */
    @Test
    void F2U_AC_22_freshInstanceHasSeededStockAndNoReservations() {
        MockDataStore other = new MockDataStore();
        other.seed();
        PartsReservationService fresh = new PartsReservationService(other);
        assertSeededCatalogue(fresh.listStock());
        other.getAllJobs().forEach(j -> assertTrue(fresh.getJobReservations(j.getId()).isEmpty()));
    }

    /** F2U_AC_21: empty list for a job with none; NotFoundException naming the id for an unknown job. */
    @Test
    void F2U_AC_21_emptyListForJobWithNoneAndNotFoundForUnknownJob() {
        Long knownJobId = store.getAllJobs().get(0).getId();
        List<Reservation> none = service.getJobReservations(knownJobId);
        assertTrue(none.isEmpty());

        NotFoundException ex = assertThrows(NotFoundException.class, () -> service.getJobReservations(9999L));
        assertTrue(ex.getMessage().contains("9999"));
        assertThrows(NotFoundException.class, () -> service.getJobReservations(null));
    }

    /** F2U_AC_1 (supporting): the returned list is a copy; changing it does not change stock (ADR-003). */
    @Test
    void F2U_AC_1_returnedListsAreCopies() {
        List<Part> stock = service.listStock();
        try {
            stock.clear();
        } catch (UnsupportedOperationException ignored) {
            // an unmodifiable list is also acceptable
        }
        assertSeededCatalogue(service.listStock());
    }

    // ---- T-4: reserve (Developer's own tests, tagged F2U_) ----

    private static ReserveRequest req(long... partQty) {
        List<ReservationLineRequest> lines = new ArrayList<>();
        for (int i = 0; i < partQty.length; i += 2) {
            ReservationLineRequest l = new ReservationLineRequest();
            l.setPartId(partQty[i]);
            l.setQuantity((int) partQty[i + 1]);
            lines.add(l);
        }
        ReserveRequest r = new ReserveRequest();
        r.setLines(lines);
        return r;
    }

    private Long jobWithStatus(JobStatus status) {
        Job j = new Job(store.nextJobId(), 1L, "Test", LocalDateTime.of(2030, 1, 1, 9, 0),
                LocalDateTime.of(2030, 1, 1, 10, 0), status);
        store.save(j);
        return j.getId();
    }

    private int available(long partId) {
        return service.listStock().stream().filter(p -> p.getId() == partId).findFirst().get().getAvailable();
    }

    private void assertUntouched() {
        assertSeededCatalogue(service.listStock());
        store.getAllJobs().forEach(j -> assertTrue(service.getJobReservations(j.getId()).isEmpty()));
    }

    private static int reservedOf(List<Reservation> list, long partId) {
        return list.stream().filter(r -> r.getPartId() == partId).mapToInt(Reservation::getQuantity).sum();
    }

    @Test
    void F2U_AC_2_singleLineIsGrantedAndStockReduced() {
        ReservationResult r = service.reserve(1L, req(1, 3));
        assertEquals(1L, r.getJobId());
        assertEquals(1, r.getReserved().size());
        assertEquals(1L, r.getReserved().get(0).getPartId());
        assertEquals(3, r.getReserved().get(0).getQuantity());
        assertEquals(9, available(1));
    }

    @Test
    void F2U_AC_3_twoPartsRecordedAscending() {
        ReservationResult r = service.reserve(1L, req(2, 4, 1, 2));
        assertEquals(2, r.getReserved().size());
        assertEquals(1L, r.getReserved().get(0).getPartId());
        assertEquals(2, r.getReserved().get(0).getQuantity());
        assertEquals(2L, r.getReserved().get(1).getPartId());
        assertEquals(4, r.getReserved().get(1).getQuantity());
        assertEquals(10, available(1));
        assertEquals(21, available(2));
        assertEquals(2, reservedOf(service.getJobReservations(1L), 1));
        assertEquals(4, reservedOf(service.getJobReservations(1L), 2));
    }

    @Test
    void F2U_AC_4_sameLinesAreAggregated() {
        ReservationResult r = service.reserve(1L, req(3, 2, 3, 3));
        assertEquals(1, r.getReserved().size());
        assertEquals(5, r.getReserved().get(0).getQuantity());
        assertEquals(1, available(3));
    }

    @Test
    void F2U_AC_5_aggregateOverStockIsRejectedUnchanged() {
        ConflictException ex = assertThrows(ConflictException.class, () -> service.reserve(1L, req(4, 2, 4, 2)));
        assertTrue(ex.getMessage().contains("4"));
        assertUntouched();
    }

    @Test
    void F2U_AC_6_oneShortPartRejectsWholeRequest() {
        assertThrows(ConflictException.class, () -> service.reserve(1L, req(1, 5, 4, 4)));
        assertUntouched();
    }

    @Test
    void F2U_AC_7_exactStockGrantedThenNextRejected() {
        service.reserve(1L, req(4, 3));
        assertEquals(0, available(4));
        assertThrows(ConflictException.class, () -> service.reserve(1L, req(4, 1)));
        assertEquals(0, available(4));
    }

    @Test
    void F2U_AC_8_laterReservationAddsToJobTotal() {
        service.reserve(1L, req(1, 2));
        service.reserve(1L, req(1, 4));
        assertEquals(6, reservedOf(service.getJobReservations(1L), 1));
        assertEquals(6, available(1));
    }

    @Test
    void F2U_AC_11_unknownJobIsNotFound() {
        NotFoundException ex = assertThrows(NotFoundException.class, () -> service.reserve(9999L, req(1, 1)));
        assertEquals("Job 9999 not found", ex.getMessage());
        assertThrows(NotFoundException.class, () -> service.reserve(null, req(1, 1)));
        assertUntouched();
    }

    @Test
    void F2U_AC_12_unknownPartRejectsValidLineToo() {
        NotFoundException ex = assertThrows(NotFoundException.class, () -> service.reserve(1L, req(1, 1, 77, 1)));
        assertEquals("Part 77 not found", ex.getMessage());
        assertUntouched();
    }

    @Test
    void F2U_AC_13_completedAndCancelledJobsAreConflict() {
        for (JobStatus s : new JobStatus[]{JobStatus.COMPLETED, JobStatus.CANCELLED}) {
            Long id = jobWithStatus(s);
            ConflictException ex = assertThrows(ConflictException.class, () -> service.reserve(id, req(1, 1)));
            assertTrue(ex.getMessage().contains(String.valueOf(id)));
            assertTrue(ex.getMessage().contains(s.name()));
        }
        assertSeededCatalogue(service.listStock());
    }

    @Test
    void F2U_AC_14_errorsAreReportedInFr12Order() {
        // invalid quantity beats unknown job
        assertThrows(IllegalArgumentException.class, () -> service.reserve(9999L, req(1, 0)));
        // unknown part beats non-SCHEDULED job
        Long done = jobWithStatus(JobStatus.COMPLETED);
        assertThrows(NotFoundException.class, () -> service.reserve(done, req(77, 1)));
        // non-SCHEDULED job beats insufficient stock, and says so
        ConflictException ex = assertThrows(ConflictException.class, () -> service.reserve(done, req(4, 50)));
        assertTrue(ex.getMessage().contains("COMPLETED"));
        assertFalse(ex.getMessage().contains("stock"));
        assertSeededCatalogue(service.listStock());
    }

    @Test
    void F2U_AC_15_jobFieldsAndJobCountAreUnchanged() {
        Job job = store.findJob(1L).get();
        Long tech = job.getTechnicianId();
        String customer = job.getCustomerName();
        LocalDateTime start = job.getStartTime();
        LocalDateTime end = job.getEndTime();
        int count = store.getAllJobs().size();

        service.reserve(1L, req(1, 1));
        assertThrows(ConflictException.class, () -> service.reserve(1L, req(4, 99)));

        Job after = store.findJob(1L).get();
        assertSame(job, after);
        assertEquals(tech, after.getTechnicianId());
        assertEquals(customer, after.getCustomerName());
        assertEquals(start, after.getStartTime());
        assertEquals(end, after.getEndTime());
        assertEquals(JobStatus.SCHEDULED, after.getStatus());
        assertEquals(count, store.getAllJobs().size());
    }

    @Test
    void F2U_AC_17_tenThreadsOneUnitOnPartFourGrantsExactlyThree() throws Exception {
        int threads = 10;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch ready = new CountDownLatch(threads);
        CountDownLatch go = new CountDownLatch(1);
        AtomicInteger granted = new AtomicInteger();
        AtomicInteger rejected = new AtomicInteger();
        List<Future<?>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < threads; i++) {
                futures.add(pool.submit(() -> {
                    ready.countDown();
                    try {
                        go.await();
                        service.reserve(1L, req(4, 1));
                        granted.incrementAndGet();
                    } catch (ConflictException e) {
                        rejected.incrementAndGet();
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }));
            }
            assertTrue(ready.await(10, TimeUnit.SECONDS));
            go.countDown();
            for (Future<?> f : futures) {
                f.get(20, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
        assertEquals(3, granted.get());
        assertEquals(7, rejected.get());
        assertEquals(0, available(4));
        assertEquals(3, reservedOf(service.getJobReservations(1L), 4));
        assertInvariant();
    }

    /** NFR-4: available plus reserved equals seeded for every part, and nothing is negative. */
    private void assertInvariant() {
        int[] seeded = {12, 25, 6, 3, 0};
        for (int i = 0; i < 5; i++) {
            long partId = i + 1;
            int reserved = store.getAllJobs().stream()
                    .mapToInt(j -> reservedOf(service.getJobReservations(j.getId()), partId)).sum();
            assertTrue(available(partId) >= 0);
            assertEquals(seeded[i], available(partId) + reserved);
        }
    }

    @Test
    void F2U_EC_4_partWithZeroAvailableIsConflict() {
        ConflictException ex = assertThrows(ConflictException.class, () -> service.reserve(1L, req(5, 1)));
        assertTrue(ex.getMessage().contains("5"));
        assertUntouched();
    }

    @Test
    void F2U_EC_5_unknownPartBeatsInsufficientStock() {
        assertThrows(NotFoundException.class, () -> service.reserve(1L, req(4, 50, 77, 1)));
        assertUntouched();
    }

    @Test
    void F2U_EC_6_sameRequestTwiceAppliesTwiceWhileStockAllows() {
        service.reserve(1L, req(1, 5));
        service.reserve(1L, req(1, 5));
        assertEquals(10, reservedOf(service.getJobReservations(1L), 1));
        assertThrows(ConflictException.class, () -> service.reserve(1L, req(1, 5)));
        assertEquals(2, available(1));
        assertInvariant();
    }

    @Test
    void F2U_EC_7_statusChangeAfterReservationKeepsReservationAndRejectsNew() {
        service.reserve(1L, req(1, 2));
        store.findJob(1L).get().setStatus(JobStatus.COMPLETED);
        assertThrows(ConflictException.class, () -> service.reserve(1L, req(1, 1)));
        assertEquals(2, reservedOf(service.getJobReservations(1L), 1));
        assertEquals(10, available(1));
    }

    @Test
    void F2U_EC_8_twoRequestsRaceForLastUnit() throws Exception {
        service.reserve(1L, req(4, 2));
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        AtomicInteger granted = new AtomicInteger();
        AtomicInteger rejected = new AtomicInteger();
        List<Future<?>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < 2; i++) {
                futures.add(pool.submit(() -> {
                    try {
                        go.await();
                        service.reserve(2L, req(4, 1));
                        granted.incrementAndGet();
                    } catch (ConflictException e) {
                        rejected.incrementAndGet();
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }));
            }
            go.countDown();
            for (Future<?> f : futures) {
                f.get(20, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, granted.get());
        assertEquals(1, rejected.get());
        assertEquals(0, available(4));
        assertInvariant();
    }

    @Test
    void F2U_EC_11_rejectedRequestAppliesNothing() {
        assertThrows(ConflictException.class, () -> service.reserve(1L, req(1, 2, 2, 3, 4, 9)));
        assertThrows(NotFoundException.class, () -> service.reserve(1L, req(1, 2, 88, 1)));
        assertUntouched();
    }

    @Test
    void F2U_messages_stockConflictNamesFirstShortPartRequestedAndAvailable() {
        ConflictException ex = assertThrows(ConflictException.class,
                () -> service.reserve(1L, req(5, 1, 4, 9, 3, 99)));
        String m = ex.getMessage();
        assertTrue(m.contains("part 3"), m);
        assertTrue(m.contains("99"), m);
        assertTrue(m.contains("6"), m);
        assertFalse(m.contains("Exception"));
        assertFalse(m.contains("com.serviceforge"));
    }

    @Test
    void F2U_defensiveChecksRejectBadRequestsWithoutChange() {
        assertThrows(IllegalArgumentException.class, () -> service.reserve(1L, null));
        assertThrows(IllegalArgumentException.class, () -> service.reserve(1L, new ReserveRequest()));
        assertThrows(IllegalArgumentException.class, () -> service.reserve(1L, req(1, -1)));
        ReserveRequest nullPart = req(1, 1);
        nullPart.getLines().get(0).setPartId(null);
        assertThrows(IllegalArgumentException.class, () -> service.reserve(1L, nullPart));
        ReserveRequest nullQty = req(1, 1);
        nullQty.getLines().get(0).setQuantity(null);
        assertThrows(IllegalArgumentException.class, () -> service.reserve(1L, nullQty));
        assertUntouched();
    }

    @Test
    void F2U_NFR_4_invariantHoldsAfterMixedRequests() {
        service.reserve(1L, req(1, 4, 2, 5));
        service.reserve(2L, req(1, 8));
        assertThrows(ConflictException.class, () -> service.reserve(3L, req(1, 1)));
        assertInvariant();
    }
}