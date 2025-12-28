import requests
import time

symbol = "SBIN"
url = f"http://127.0.0.1:8000/api/ratios/{symbol}"

try:
    print(f"Calling API: {url}")
    response = requests.get(url, timeout=10)
    if response.status_code == 200:
        data = response.json()
        print("\n--- API Response ---")
        import json
        print(json.dumps(data, indent=2))
        
        # Check specific fields
        margin = data.get("Profitability", {}).get("Net Margin")
        de = data.get("Leverage", {}).get("Debt/Equity")
        peg = data.get("Valuation", {}).get("PEG")
        roa = data.get("Profitability", {}).get("ROA")
        
        if margin != "N/A": print(f"\nSUCCESS: Net Margin found: {margin}")
        else: print(f"\nFAILURE: Net Margin is N/A")
            
        if de != "N/A": print(f"SUCCESS: Debt/Equity found: {de}")
        else: print(f"FAILURE: Debt/Equity is N/A")
        
        if peg != "N/A": print(f"SUCCESS: PEG found: {peg}")
        else: print(f"FAILURE: PEG is N/A")
        
        if roa != "N/A": print(f"SUCCESS: ROA found: {roa}")
        else: print(f"FAILURE: ROA is N/A")
            
    else:
        print(f"Error: Status {response.status_code}")
except Exception as e:
    print(f"Error: {e}")
    print("Ensure the server (Uvicorn) is running!")
