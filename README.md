# Personal Finance Desktop

A local Electron and AngularJS app for manually recording account balances and purchases. MySQL stores all data. It never connects to a bank or financial institution.

## Requirements

- Node.js 20 or newer
- MySQL 8 running locally

## Setup

1. Run `npm install`.
2. Copy `.env.example` to `.env` and set your MySQL username and password. The MySQL user must be able to create the `personal_finance` database and tables on first run.
3. Run `npm start` to open the desktop app. The local web server listens on `127.0.0.1:3000` by default.

Run `npm run start:web` to use the same app in a browser at `http://127.0.0.1:3000` without Electron. No login is required because the service is bound to your computer only. Keep MySQL access local as well.

## Weekly balance spreadsheet

When adding an account, select an `.xlsx` file whose first worksheet has these columns in row 1:

| Week | Balance |
| --- | ---: |
| 2026-09-14 | 4250.00 |
| 2026-09-21 | 4312.45 |

Dates may be Excel dates or `YYYY-MM-DD` text. Each date is assigned to its Monday week. One balance per week is stored, and the last row for a repeated week wins. You can also add or update a balance manually from the Accounts screen. Account balances are snapshots; purchases do not automatically change them.

## Data

In **Add purchase**, choose **New category** below the category selector to create a reusable category. Creating it selects it for the current purchase. Category names must be unique and contain 1–60 characters. Custom categories appear in spending charts once purchases use them, including month, year, and all-time views.

Choose **Manage categories** from Purchases, Spending, or Add purchase to rename or delete custom categories. Renaming updates every existing purchase in that category. Deleting requires confirmation and moves those purchases to **Other**, preserving purchase history and spending totals. Charts and purchase selections update automatically. Built-in categories cannot be renamed or deleted.

Restart the app after updating to initialize category storage. Existing purchase categories are added automatically, and saved categories remain available even if their purchases are deleted.

The server creates the database and tables automatically. To back up your data, use `mysqldump personal_finance` (with your MySQL credentials). Deleting the app folder does not delete the MySQL database.
