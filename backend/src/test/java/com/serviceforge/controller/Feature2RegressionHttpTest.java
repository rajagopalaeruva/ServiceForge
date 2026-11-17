package com.serviceforge.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.serviceforge.data.MockDataStore;
import com.serviceforge.model.Job;
import com.serviceforge.model.JobStatus;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Feature 2, T-9: EC-10 (a reservation leaves the technician's other jobs and booking decisions unchanged) and
 * NFR-8 (Feature 1 endpoints keep their request and response contracts). Full Spring context, MockMvc, fresh
 * context for every test method. No network port is opened.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
class Feature2RegressionHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final LocalDateTime DAY = LocalDateTime.of(2030, 3, 1, 0, 0);

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private MockDataStore dataStore;

    private Job saveJob(long technicianId, int startHour, int startMinute, int endHour, int endMinute) {
        return dataStore.save(new Job(dataStore.nextJobId(), technicianId, "Existing Customer",
                DAY.plusHours(startHour).plusMinutes(startMinute),
                DAY.plusHours(endHour).plusMinutes(endMinute), JobStatus.SCHEDULED));
    }

    private MvcResult call(org.springframework.test.web.servlet.RequestBuilder builder) throws Exception {
        return mockMvc.perform(builder).andReturn();
    }

    private int book(long technicianId, String day, String start, String end) throws Exception {
        return call(post("/api/jobs").contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"technicianId": %d, "customerName": "Regression Customer",
                         "startTime": "%sT%s", "endTime": "%sT%s"}
                        """.formatted(technicianId, day, start, day, end))).getResponse().getStatus();
    }

    private int reserve(long jobId, long partId, int quantity) throws Exception {
        return call(post("/api/jobs/" + jobId + "/reservations").contentType(MediaType.APPLICATION_JSON)
                .content("{\"lines\":[{\"partId\":" + partId + ",\"quantity\":" + quantity + "}]}"))
                .getResponse().getStatus();
    }

    private String jobsOf(long technicianId) throws Exception {
        return call(get("/api/technicians/" + technicianId + "/jobs")).getResponse().getContentAsString();
    }

    @Test
    void F2_EC_10_reservationLeavesTechniciansOtherJobsAndBookingDecisionsUnchanged() throws Exception {
        // Technician 3 has no seeded jobs. A, B, C are back to back with exactly 45 minutes between them;
        // D overlaps B (saved directly, as the API would reject it).
        saveJob(3, 8, 0, 9, 0);                       // A 08:00-09:00
        Job b = saveJob(3, 9, 45, 10, 45);            // B 09:45-10:45 (adjacent to A)
        saveJob(3, 11, 30, 12, 30);                   // C 11:30-12:30 (adjacent to B)
        saveJob(3, 10, 0, 11, 0);                     // D 10:00-11:00 (overlaps B)
        String otherTechnicianBefore = jobsOf(1);
        String before = jobsOf(3);
        JsonNode beforeList = JSON.readTree(before);
        assertEquals(4, beforeList.size());

        assertEquals(201, reserve(b.getId(), 1, 2), "the reservation for the job with neighbours is granted");
        assertEquals(409, reserve(b.getId(), 5, 1), "a rejected reservation (part 5 has 0 units)");

        assertEquals(before, jobsOf(3), "technician 3's jobs are unchanged after a granted and a rejected reservation");
        assertEquals(otherTechnicianBefore, jobsOf(1), "technician 1's jobs are unchanged");

        // Booking decisions are the Feature 1 rules, as before.
        assertEquals(409, book(3, "2030-03-01", "12:00", "13:00"), "overlaps C");
        assertEquals(409, book(3, "2030-03-01", "13:14", "14:14"), "44 minutes after C");
        assertEquals(201, book(3, "2030-03-01", "13:15", "14:15"), "exactly 45 minutes after C is allowed");
        assertEquals(5, JSON.readTree(jobsOf(3)).size(), "only the one accepted booking was added");
    }

    @Test
    void F2_NFR_8_featureOneTechnicianEndpointsKeepTheirContracts() throws Exception {
        MvcResult list = call(get("/api/technicians"));
        assertEquals(200, list.getResponse().getStatus());
        JsonNode technicians = JSON.readTree(list.getResponse().getContentAsString());
        assertTrue(technicians.isArray());
        assertEquals(3, technicians.size());
        for (JsonNode t : technicians) {
            assertEquals(keys("id", "name", "region"), fieldNames(t), "technician fields");
        }
        assertEquals("Jordan Reyes", technicians.get(0).get("name").asText());
        assertEquals("North", technicians.get(0).get("region").asText());

        MvcResult one = call(get("/api/technicians/2"));
        assertEquals(200, one.getResponse().getStatus());
        JsonNode technician = JSON.readTree(one.getResponse().getContentAsString());
        assertEquals(keys("id", "name", "region"), fieldNames(technician));
        assertEquals(2, technician.get("id").asInt());

        MvcResult missing = call(get("/api/technicians/999"));
        assertEquals(404, missing.getResponse().getStatus());
        JsonNode missingBody = JSON.readTree(missing.getResponse().getContentAsString());
        assertEquals(keys("message"), fieldNames(missingBody));
        assertTrue(missingBody.get("message").asText().contains("999"));

        MvcResult jobs = call(get("/api/technicians/1/jobs"));
        assertEquals(200, jobs.getResponse().getStatus());
        JsonNode jobList = JSON.readTree(jobs.getResponse().getContentAsString());
        assertEquals(2, jobList.size(), "technician 1 has two seeded jobs");
        for (JsonNode j : jobList) {
            assertEquals(keys("id", "technicianId", "customerName", "startTime", "endTime", "status"),
                    fieldNames(j), "job fields");
            assertEquals("SCHEDULED", j.get("status").asText());
        }

        MvcResult missingJobs = call(get("/api/technicians/999/jobs"));
        assertEquals(404, missingJobs.getResponse().getStatus());
        assertEquals(keys("message"), fieldNames(JSON.readTree(missingJobs.getResponse().getContentAsString())));
    }

    @Test
    void F2_NFR_8_featureOneBookingEndpointKeepsItsContractAfterAReservation() throws Exception {
        assertEquals(201, reserve(1, 1, 1), "make a reservation first so Feature 2 state exists");

        MvcResult created = call(post("/api/jobs").contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"technicianId": 2, "customerName": "Contract Customer",
                         "startTime": "2031-05-01T09:00", "endTime": "2031-05-01T10:00"}
                        """));
        assertEquals(201, created.getResponse().getStatus());
        JsonNode job = JSON.readTree(created.getResponse().getContentAsString());
        assertEquals(keys("id", "technicianId", "customerName", "startTime", "endTime", "status"), fieldNames(job));
        assertEquals(2, job.get("technicianId").asInt());
        assertEquals("Contract Customer", job.get("customerName").asText());
        assertEquals("SCHEDULED", job.get("status").asText());

        MvcResult conflict = call(post("/api/jobs").contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"technicianId": 2, "customerName": "Contract Customer",
                         "startTime": "2031-05-01T10:00", "endTime": "2031-05-01T11:00"}
                        """));
        assertEquals(409, conflict.getResponse().getStatus());
        JsonNode conflictBody = JSON.readTree(conflict.getResponse().getContentAsString());
        assertEquals(keys("message"), fieldNames(conflictBody));
        assertTrue(conflictBody.get("message").asText().contains("45"));

        MvcResult invalid = call(post("/api/jobs").contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"technicianId": 2, "customerName": "",
                         "startTime": "2031-06-01T09:00", "endTime": "2031-06-01T10:00"}
                        """));
        assertEquals(400, invalid.getResponse().getStatus());
        JsonNode invalidBody = JSON.readTree(invalid.getResponse().getContentAsString());
        assertEquals(keys("message"), fieldNames(invalidBody));
        assertFalse(invalidBody.get("message").asText().isBlank());

        MvcResult unknownTechnician = call(post("/api/jobs").contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"technicianId": 999, "customerName": "Contract Customer",
                         "startTime": "2031-07-01T09:00", "endTime": "2031-07-01T10:00"}
                        """));
        assertEquals(404, unknownTechnician.getResponse().getStatus());
        assertEquals(keys("message"),
                fieldNames(JSON.readTree(unknownTechnician.getResponse().getContentAsString())));
    }

    private static TreeSet<String> keys(String... names) {
        return new TreeSet<>(List.of(names));
    }

    private static TreeSet<String> fieldNames(JsonNode node) {
        List<String> names = new ArrayList<>();
        node.fieldNames().forEachRemaining(names::add);
        return new TreeSet<>(names);
    }
}
