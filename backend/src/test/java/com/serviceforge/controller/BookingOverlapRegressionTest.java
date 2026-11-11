package com.serviceforge.controller;

import com.serviceforge.data.MockDataStore;
import com.serviceforge.model.Job;
import com.serviceforge.model.JobStatus;
import com.serviceforge.model.Technician;
import com.serviceforge.service.TechnicianAvailabilityService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalDateTime;
import java.util.Optional;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.spy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class BookingOverlapRegressionTest {

    private MockDataStore dataStore;
    private MockMvc mockMvc;
    private int initialJobCount;
    private LocalDateTime day;

    @BeforeEach
    void setUp() {
        dataStore = spy(new MockDataStore());
        doReturn(Optional.of(new Technician(1L, "Other Technician", "North")))
                .when(dataStore).findTechnician(1L);
        doReturn(Optional.of(new Technician(3L, "Regression Technician", "East")))
                .when(dataStore).findTechnician(3L);
        day = LocalDateTime.of(2030, 1, 15, 0, 0);
        saveExistingJob(day.plusHours(9), day.plusHours(11));
        mockMvc = MockMvcBuilders.standaloneSetup(
                new JobController(new TechnicianAvailabilityService(dataStore))).build();
        initialJobCount = dataStore.getAllJobs().size();
    }

    @ParameterizedTest(name = "{0}: {1}-{2}")
    @CsvSource({
            "AC-1, 10:00, 12:00",
            "AC-1, 08:00, 10:00",
            "AC-1, 09:30, 10:30",
            "AC-1, 08:00, 12:00",
            "AC-1, 09:00, 10:00",
            "AC-2, 11:00, 12:00",
            "AC-2, 11:44, 12:44",
            "AC-3, 07:30, 08:30"
    })
    void rejectsConflictsWithoutSavingAndReturnsApiError(String criterion, String start, String end)
            throws Exception {
        mockMvc.perform(post("/api/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request(3L, "2030-01-15T" + start, "2030-01-15T" + end)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("conflict")))
                .andExpect(jsonPath("$.message", containsString("45")));

        assertEquals(initialJobCount, dataStore.getAllJobs().size(), criterion + " / AC-7");
    }

    @ParameterizedTest(name = "{0}: technician {1}, {2}-{3}")
    @CsvSource({
            "AC-4, 3, 11:45, 12:45",
            "AC-4, 3, 07:00, 08:15",
            "AC-4, 3, 13:00, 14:00",
            "AC-5, 1, 10:00, 12:00"
    })
    void acceptsAvailableIntervals(String criterion, long technicianId, String start, String end)
            throws Exception {
        mockMvc.perform(post("/api/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request(technicianId, "2030-01-15T" + start, "2030-01-15T" + end)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.technicianId").value(technicianId))
                .andExpect(jsonPath("$.customerName").value("Regression Customer"));

        assertEquals(initialJobCount + 1, dataStore.getAllJobs().size(), criterion);
    }

    @ParameterizedTest(name = "AC-6: next day {0}, HTTP {2}")
    @CsvSource({
            "00:14, 01:14, 409",
            "00:15, 01:15, 201"
    })
    void appliesTravelBufferAcrossMidnight(String start, String end, int expectedStatus) throws Exception {
        saveExistingJob(day.plusHours(23), day.plusHours(23).plusMinutes(30));
        int countBeforeRequest = dataStore.getAllJobs().size();

        var result = mockMvc.perform(post("/api/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request(3L, "2030-01-16T" + start, "2030-01-16T" + end)))
                .andExpect(status().is(expectedStatus));
        if (expectedStatus == 409) {
            result.andExpect(jsonPath("$.message", containsString("conflict")))
                    .andExpect(jsonPath("$.message", containsString("45")));
        }
        assertEquals(countBeforeRequest + (expectedStatus == 201 ? 1 : 0),
                dataStore.getAllJobs().size(), "AC-6 / AC-7");
    }

    private void saveExistingJob(LocalDateTime start, LocalDateTime end) {
        dataStore.save(new Job(dataStore.nextJobId(), 3L, "Existing Customer",
                start, end, JobStatus.SCHEDULED));
    }

    private String request(long technicianId, String start, String end) {
        return """
                {"technicianId": %d, "customerName": "Regression Customer",
                 "startTime": "%s", "endTime": "%s"}
                """.formatted(technicianId, start, end);
    }
}
