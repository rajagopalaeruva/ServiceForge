export interface Part {
  id: number;
  name: string;
  available: number;
}

export interface ReservationLine {
  partId: number;
  quantity: number;
}

export interface ReserveRequest {
  lines: ReservationLine[];
}

export interface ReserveResult {
  jobId: number;
  reserved: ReservationLine[];
}
