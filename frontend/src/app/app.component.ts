import { Component, ViewChild } from '@angular/core';
import { StockViewComponent } from './stock-view/stock-view.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'ServiceForge';

  @ViewChild(StockViewComponent) stockView?: StockViewComponent;

  onReserved(): void {
    this.stockView?.loadParts();
  }
}