import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { Technician } from '../models/technician.model';
import { Job, BookJobRequest } from '../models/job.model';
import { Part, ReservationLine, ReserveResult } from '../models/part.model';
import { TechnicianService } from '../services/technician.service';
import { PartsService } from '../services/parts.service';

export interface ReservationFormLine {
  partId: number | null;
  quantity: number | null;
}

@Component({
  selector: 'app-technician-calendar',
  templateUrl: './technician-calendar.component.html',
  styleUrls: ['./technician-calendar.component.css']
})
export class TechnicianCalendarComponent implements OnInit {

  /** Emitted after a granted reservation so the parent can refresh the stock view. */
  @Output() reserved = new EventEmitter<void>();

  technicians: Technician[] = [];
  selectedTechnicianId: number | null = null;
  jobs: Job[] = [];

  newCustomerName = '';
  newStartTime = '';
  newEndTime = '';
  errorMessage = '';

  parts: Part[] = [];
  reservingJob: Job | null = null;
  reserveLines: ReservationFormLine[] = [];
  confirming = false;
  reserveErrorMessage = '';
  reserveSuccessMessage = '';

  constructor(private technicianService: TechnicianService,
              private partsService: PartsService) {}

  ngOnInit(): void {
    this.technicianService.getTechnicians().subscribe(technicians => {
      this.technicians = technicians;
      if (technicians.length > 0) {
        this.selectTechnician(technicians[0].id);
      }
    });
  }

  selectTechnician(technicianId: number): void {
    this.selectedTechnicianId = technicianId;
    this.errorMessage = '';
    this.cancelReserve();
    this.reserveSuccessMessage = '';
    this.loadJobs();
  }

  loadJobs(): void {
    if (this.selectedTechnicianId === null) {
      return;
    }
    this.technicianService.getJobsForTechnician(this.selectedTechnicianId)
      .subscribe(jobs => {
        this.jobs = jobs.sort((a, b) => a.startTime.localeCompare(b.startTime));
      });
  }

  bookJob(): void {
    if (this.selectedTechnicianId === null || !this.newCustomerName || !this.newStartTime || !this.newEndTime) {
      this.errorMessage = 'Fill in customer name, start time, and end time.';
      return;
    }

    const request: BookJobRequest = {
      technicianId: this.selectedTechnicianId,
      customerName: this.newCustomerName,
      startTime: this.newStartTime,
      endTime: this.newEndTime
    };

    this.errorMessage = '';
    this.technicianService.bookJob(request).subscribe({
      next: () => {
        this.newCustomerName = '';
        this.newStartTime = '';
        this.newEndTime = '';
        this.loadJobs();
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Could not book this job.';
      }
    });
  }

  canReserve(job: Job): boolean {
    return job.status === 'SCHEDULED';
  }

  startReserve(job: Job): void {
    if (!this.canReserve(job)) {
      return;
    }
    this.reservingJob = job;
    this.reserveLines = [{ partId: null, quantity: null }];
    this.confirming = false;
    this.reserveErrorMessage = '';
    this.reserveSuccessMessage = '';
    this.partsService.getParts().subscribe({
      next: parts => { this.parts = parts; },
      error: (err) => {
        this.reserveErrorMessage = err?.error?.message || 'Could not load the parts list.';
      }
    });
  }

  addLine(): void {
    this.reserveLines.push({ partId: null, quantity: null });
  }

  removeLine(index: number): void {
    if (this.reserveLines.length > 1) {
      this.reserveLines.splice(index, 1);
    }
  }

  cancelReserve(): void {
    this.reservingJob = null;
    this.reserveLines = [];
    this.confirming = false;
    this.reserveErrorMessage = '';
  }

  reviewReservation(): void {
    this.reserveErrorMessage = '';
    const incomplete = this.reserveLines.some(l => l.partId === null || l.quantity === null);
    if (incomplete) {
      this.reserveErrorMessage = 'Choose a part and enter a quantity on every line.';
      return;
    }
    this.confirming = true;
  }

  backToEdit(): void {
    this.confirming = false;
  }

  confirmReservation(): void {
    if (this.reservingJob === null) {
      return;
    }
    const job = this.reservingJob;
    const lines: ReservationLine[] = this.reserveLines.map(l => ({
      partId: Number(l.partId),
      quantity: Number(l.quantity)
    }));
    this.reserveErrorMessage = '';
    this.partsService.reserveParts(job.id, { lines }).subscribe({
      next: (result: ReserveResult) => {
        this.reserveSuccessMessage = 'Reserved for job ' + this.jobLabel(job) + ': '
          + result.reserved.map(r => r.quantity + ' x ' + this.partName(r.partId)).join(', ') + '.';
        this.cancelReserve();
        this.reserved.emit();
      },
      error: (err) => {
        this.confirming = false;
        this.reserveErrorMessage = err?.error?.message || 'Could not reserve these parts.';
      }
    });
  }

  jobLabel(job: Job): string {
    return '#' + job.id + ' (' + job.customerName + ', ' + job.startTime + ')';
  }

  partName(partId: number | null): string {
    const part = this.parts.find(p => p.id === Number(partId));
    return part ? part.name : 'part ' + partId;
  }
}