import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Part, ReservationLine, ReserveRequest, ReserveResult } from '../models/part.model';

@Injectable({ providedIn: 'root' })
export class PartsService {

  private readonly baseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  getParts(): Observable<Part[]> {
    return this.http.get<Part[]>(`${this.baseUrl}/parts`);
  }

  reserveParts(jobId: number, request: ReserveRequest): Observable<ReserveResult> {
    return this.http.post<ReserveResult>(`${this.baseUrl}/jobs/${jobId}/reservations`, request);
  }

  getJobReservations(jobId: number): Observable<ReservationLine[]> {
    return this.http.get<ReservationLine[]>(`${this.baseUrl}/jobs/${jobId}/reservations`);
  }
}
