import { Component, OnInit } from '@angular/core';
import { Part } from '../models/part.model';
import { PartsService } from '../services/parts.service';

@Component({
  selector: 'app-stock-view',
  templateUrl: './stock-view.component.html',
  styleUrls: ['./stock-view.component.css']
})
export class StockViewComponent implements OnInit {

  parts: Part[] = [];
  errorMessage = '';

  constructor(private partsService: PartsService) {}

  ngOnInit(): void {
    this.loadParts();
  }

  loadParts(): void {
    this.errorMessage = '';
    this.partsService.getParts().subscribe({
      next: parts => {
        this.parts = parts;
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Could not load the stock.';
      }
    });
  }
}
