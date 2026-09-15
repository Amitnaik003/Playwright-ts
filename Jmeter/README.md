# Apache JMeter Performance Test Plans

This folder (`c:\Playwright\Jmeter\`) contains production-ready **Apache JMeter Test Plans (`.jmx` files)** for load testing all modules in the application.

---

## 📁 Included Test Plans

1. **`all_modules_performance_test.jmx`**: Master Test Plan containing Thread Groups for **all 6 modules**:
   - Admin Pages (User Profile, Help, Ticketing System)
   - Analytics Pages (Scorecard, Report Configurator, Criteria, Generator, Setups, Configurator V2, Report Criteria)
   - Automation Pages (Plant Customer Cross Ref, Program Mapping, Program Variant, Task, Scheduler, Adapters, Logical System, Internal Cross Ref, Screen Config, Mail, FTP/SFTP)
   - Master Pages (Enterprise, External Filter, Org Unit, Location, Customer, Portal, Role, User, Position, Program Repository)
   - Monitor Pages (Process Monitor, Communication Monitor, Support Report, Message Monitor)
   - Warranty Pages (Common Data View, Part Return Analysis, Master Data, Part Return Conclusion, Lookup Table)

2. **Modular Test Plans**:
   - `admin_performance_test.jmx`
   - `analytics_performance_test.jmx`
   - `automation_performance_test.jmx`
   - `master_pages_performance_test.jmx`
   - `monitor_performance_test.jmx`
   - `warranty_performance_test.jmx`

---

## 🚀 How to Run the JMeter Tests

### Method 1: Using Apache JMeter GUI Mode
1. Open Apache JMeter (`jmeter.bat` on Windows).
2. Click **File -> Open** and select any `.jmx` file (e.g. `all_modules_performance_test.jmx`).
3. Click the green **Start** button (▶) or press `Ctrl + R`.
4. View real-time results in **Summary Report**, **Aggregate Report**, and **View Results Tree**.

---

### Method 2: Non-GUI / CLI Mode (Recommended for High Concurrency)

Run 50 parallel threads / users via command prompt:

```bash
# Run Master Test Plan with 50 threads
jmeter -n -t all_modules_performance_test.jmx -l results.jtl -e -o html_report
```

#### Overriding Parameters dynamically from CLI:
```bash
# Run 100 parallel threads with 10s ramp-up across 2 repeat loops
jmeter -n -t all_modules_performance_test.jmx -Jthreads=100 -Jrampup=10 -Jloops=2 -l results.jtl -e -o html_report
```

---

## 📊 Summary of Output Metrics

Each test plan automatically generates:
- **Throughput (Requests/sec)**
- **Min, Max, Average, Median, and P95 Response Latencies (ms)**
- **HTTP Error Rate (%)**
- **HTML Performance Dashboard**
