import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

import { AppComponent } from './app.component';
import { TechnicianCalendarComponent } from './technician-calendar/technician-calendar.component';
import { StockViewComponent } from './stock-view/stock-view.component';

@NgModule({
  declarations: [
    AppComponent,
    TechnicianCalendarComponent,
    StockViewComponent
  ],
  imports: [
    BrowserModule,
    HttpClientModule,
    FormsModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
