from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from nsepython import nse_eq, equity_history
import uvicorn
from mangum import Mangum
from datetime import datetime, timedelta
import pandas as pd
from pathlib import Path
import json

app = FastAPI()

#app.mount("/static", StaticFiles(directory="static"), name="static")
BASE_DIR = Path(__file__).resolve().parent
app.mount(
    "/static",
    StaticFiles(directory=BASE_DIR.parent / "static"),
    name="static"
)
templates = Jinja2Templates(directory=BASE_DIR / "templates")
# templates = Jinja2Templates(directory="templates")

handler = Mangum(app)

@app.get("/")
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/api/quote/{symbol}")
async def get_quote(symbol: str):
    try:
        # Use nse_eq for better reliability with PriceInfo
        data = nse_eq(symbol)
        if not data:
             raise HTTPException(status_code=404, detail="Symbol not found")
        return data
    except Exception as e:
        print(f"Error fetching quote for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

import yfinance as yf

import requests

ALPHA_VANTAGE_API_KEY = "KUNVOVYC3GNS103S"

import yfinance as yf
from datetime import datetime

@app.get("/api/history/{symbol}")
async def get_history(symbol: str):
    try:
        # NSE stocks require .NS suffix in yfinance
        ticker_symbol = f"{symbol}.NS"
        print(f"Fetching history for {ticker_symbol} using yfinance...")

        ticker = yf.Ticker(ticker_symbol)

        # Last 1 month (≈ 30 days)
        hist = ticker.history(period="1mo")

        if hist.empty:
            print("No historical data returned from yfinance")
            return []

        results = []

        for index, row in hist.iterrows():
            results.append({
                "Date": index.strftime("%d-%m-%Y"),
                "Open": round(row["Open"], 2),
                "High": round(row["High"], 2),
                "Low": round(row["Low"], 2),
                "Close": round(row["Close"], 2)
            })

        print(f"Fetched {len(results)} records from yfinance")
        return results

    except Exception as e:
        print(f"Error fetching history for {symbol}: {e}")
        return []


import re

@app.get("/api/ratios/{symbol}")
async def get_ratios(symbol: str):
    ratios = {
        "Valuation": {"P/E": "N/A", "PEG": "N/A", "P/B": "N/A"},
        "Profitability": {"ROE": "N/A", "ROA": "N/A", "Net Margin": "N/A"},
        "Liquidity": {"Current Ratio": "N/A", "Quick Ratio": "N/A"},
        "Leverage": {"Debt/Equity": "N/A"},
        "Efficiency": {"Asset Turnover": "N/A"}
    }
    
    try:
        # Use Screener.in for robust Indian fundamental data
        print(f"Fetching fundamentals for {symbol} from Screener.in...")
        url = f"https://www.screener.in/company/{symbol}/"
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        
        # No need for async context manager with synchronous requests library
        response = requests.get(url, headers=headers, timeout=5)
             
        if response.status_code == 200:
             html = response.text
             
             def extract_value(label):
                 # Robust regex extraction handling whitespace and newlines
                 # Pattern looks for: > [whitespace] Label [whitespace] < ... [skip chars] ... class="number"> [Value] <
                 try:
                    pattern = r'>\s*' + re.escape(label) + r'\s*<.*?class="number">(.*?)<'
                    match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
                    if match:
                        return match.group(1).strip()
                    return "N/A"
                 except:
                     return "N/A"

             # 1. Valuation
             pe = extract_value("Stock P/E")
             if pe != "N/A": ratios["Valuation"]["P/E"] = pe
             
             roce = extract_value("ROCE") 
             roe = extract_value("ROE")
             if roe != "N/A": ratios["Profitability"]["ROE"] = roe + "%"
             
             # Book Value -> P/B
             book_val_str = extract_value("Book Value")
             curr_price_str = extract_value("Current Price")
             
             if book_val_str != "N/A" and curr_price_str != "N/A":
                 try:
                     bv = float(book_val_str.replace(",", ""))
                     cp = float(curr_price_str.replace(",", ""))
                     if bv > 0:
                         pb = round(cp / bv, 2)
                         ratios["Valuation"]["P/B"] = str(pb)
                 except:
                     pass

             # PEG Ratio (Often not in top cards, but let's check)
             # Sometimes labeled as "PEG Ratio" if customized
             
             # --- Advanced Table Parsing for Net Margin & Others ---
             def extract_from_table(row_label):
                # Robust Regex to find the <tr> containing the label
                # We use re.IGNORECASE to be safer
                try:
                    pattern = r'<tr[^>]*>(?:(?!</tr>).)*?' + re.escape(row_label) + r'(?:(?!</tr>).)*?</tr>'
                    match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
                    
                    if not match: return None
                    
                    row_html = match.group(0)
                    
                    # Extract cells
                    cell_vals = re.findall(r'<td[^>]*>(.*?)</td>', row_html, re.DOTALL | re.IGNORECASE)
                    
                    numeric_vals = []
                    for val in cell_vals:
                        # Remove HTML tags (buttons, spans)
                        val_clean = re.sub(r'<[^>]+>', '', val).strip()
                        val_clean = val_clean.replace(",", "")
                        
                        if re.match(r'^-?\d+(\.\d+)?$', val_clean):
                            numeric_vals.append(float(val_clean))
                            
                    if numeric_vals:
                        return numeric_vals[-1] # Return TTM/Latest
                    return None
                except:
                    return None

             # Net Margin = (Net Profit / Sales) * 100
             # Note: This might fetch Quarterly Net Profit if that table appears first.
             # Margin % is same for Quarterly or Annual ideally, so acceptable.
             net_profit = extract_from_table("Net Profit")
             sales = extract_from_table("Sales") 
             if not sales: sales = extract_from_table("Revenue")
             if not sales: sales = extract_from_table("Interest Earned") # For Banks
             
             if net_profit is not None and sales and sales > 0:
                 margin = (net_profit / sales) * 100
                 ratios["Profitability"]["Net Margin"] = f"{margin:.2f}%"

             # Debt / Equity
             borrowings = extract_from_table("Borrowings")
             share_cap = extract_from_table("Share Capital")
             reserves = extract_from_table("Reserves")
             
             if borrowings is not None and share_cap and reserves:
                 equity = share_cap + reserves
                 if equity > 0:
                     de = borrowings / equity
                     ratios["Leverage"]["Debt/Equity"] = f"{de:.2f}"
             
             # --- ROA & Asset Turnover ---
             total_assets = extract_from_table("Total Assets")
             if total_assets and total_assets > 0:
                 if net_profit:
                     roa = (net_profit / total_assets) * 100
                     ratios["Profitability"]["ROA"] = f"{roa:.2f}%"
                 
                 if sales:
                     ato = sales / total_assets
                     ratios["Efficiency"]["Asset Turnover"] = f"{ato:.2f}"

             # --- PEG Ratio ---
             # Need Profit Growth (3 Years or 5 Years)
             # Table logic: <td>3 Years:</td> ... <td>20%</td>
             def extract_growth(label_years):
                try:
                    pattern = r'<td>\s*' + re.escape(label_years) + r':?\s*</td>\s*<td>\s*(-?[\d.]+)%\s*</td>'
                    match = re.search(pattern, html, re.IGNORECASE)
                    if match:
                        return float(match.group(1))
                    return None
                except:
                    return None

             growth_rate = extract_growth("3 Years")
             if not growth_rate: growth_rate = extract_growth("5 Years")
             
             if growth_rate and growth_rate > 0:
                 # PEG = P/E / Growth Rate
                 pe_str = ratios["Valuation"]["P/E"]
                 if pe_str != "N/A":
                     try:
                         pe_val = float(pe_str)
                         peg = pe_val / growth_rate
                         ratios["Valuation"]["PEG"] = f"{peg:.2f}"
                     except:
                         pass

             # --- Liquidity (Current Ratio) ---
             # For non-banks: Current Assets / Current Liabilities
             curr_assets = extract_from_table("Current Assets") # Often "Other Assets" on summary is different
             curr_liab = extract_from_table("Current Liabilities") # Often "Other Liabilities"
             
             if curr_assets and curr_liab and curr_liab > 0:
                 cr = curr_assets / curr_liab
                 ratios["Liquidity"]["Current Ratio"] = f"{cr:.2f}"
             
             # Fallback: check nse_eq for P/E only if missing (Screener usually has it)
             if ratios["Valuation"]["P/E"] == "N/A":
                 print("Screener P/E not found, falling back to NSE...")
                 nse_data = nse_eq(symbol)
                 if nse_data and "metadata" in nse_data:
                    pe = nse_data["metadata"].get("pdSymbolPe")
                    if pe: ratios["Valuation"]["P/E"] = str(pe)

    except Exception as e:
        print(f"Error fetching ratios for {symbol}: {e}")
        
    return ratios



if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
