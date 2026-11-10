(function () {
  'use strict';
  var app = angular.module('financeApp', []);

  app.filter('initial', function () { return function (value) { return value ? value.charAt(0).toUpperCase() : '?'; }; });
  app.filter('prettyDate', function () { return function (value) {
    if (!value) return '';
    var parts = String(value).slice(0, 10).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }; });
  app.directive('fileModel', function () { return { restrict: 'A', scope: { fileModel: '=' }, link: function (scope, element) {
    element.on('change', function () { scope.$apply(function () { scope.fileModel = element[0].files[0] || null; }); });
  } }; });

  app.controller('FinanceController', function ($http, $timeout, $scope) {
    var vm = this;
    var chart;
    var spendingChart;
    var noticeTimer;
    vm.page = 'overview';
    vm.pageLabel = 'Overview';
    vm.todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    vm.accounts = [];
    vm.balances = [];
    vm.purchases = [];
    vm.totalBalance = 0;
    vm.monthSpending = 0;
    vm.allTimeSpending = 0;
    vm.accountTypes = ['Checking', 'Savings', 'Credit', 'Investment', 'Cash', 'Other'];
    vm.categories = ['Food & Drink', 'Groceries', 'Shopping', 'Transport', 'Bills & Utilities', 'Housing', 'Health', 'Entertainment', 'Travel', 'Education', 'Other'];
    var defaultCategories = vm.categories.slice();
    vm.spendingPeriod = 'month';
    vm.spendingYear = String(new Date().getFullYear());
    vm.spendingMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    vm.months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(function (name, index) {
      return { name: name, value: String(index + 1).padStart(2, '0') };
    });
    var categoryColors = ['#8676f7', '#37b99a', '#56a5ed', '#e7ae51', '#f38573', '#6e7f9c', '#c868ab', '#57944a', '#b98246', '#4d789d', '#9593a5'];
    vm.colors = [
      { name: 'Violet', value: '#8676f7' }, { name: 'Blue', value: '#56a5ed' },
      { name: 'Mint', value: '#37b99a' }, { name: 'Coral', value: '#f38573' },
      { name: 'Gold', value: '#e7ae51' }, { name: 'Slate', value: '#6e7f9c' }
    ];

    function localDate(date) {
      var pad = function (n) { return String(n).padStart(2, '0'); };
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    }
    function showError(error) { vm.error = error && error.data && error.data.error ? error.data.error : 'Could not complete that action. Check that MySQL is running.'; }
    function showNotice(message) {
      vm.notice = message;
      if (noticeTimer) $timeout.cancel(noticeTimer);
      noticeTimer = $timeout(function () { vm.notice = ''; }, 3500);
    }
    function refresh() {
      return Promise.all([$http.get('/api/accounts'), $http.get('/api/balances'), $http.get('/api/purchases'), $http.get('/api/categories')]).then(function (results) {
        vm.accounts = results[0].data;
        vm.balances = results[1].data;
        vm.purchases = results[2].data;
        vm.categories = results[3].data;
        vm.updateSpending();
        vm.totalBalance = vm.accounts.reduce(function (sum, item) { return sum + Number(item.latest_balance || 0); }, 0);
        vm.allTimeSpending = vm.purchases.reduce(function (sum, item) { return sum + Number(item.amount); }, 0);
        var month = localDate(new Date()).slice(0, 7);
        vm.monthSpending = vm.purchases.filter(function (item) { return item.purchase_date.slice(0, 7) === month; }).reduce(function (sum, item) { return sum + Number(item.amount); }, 0);
        if (vm.selectedAccountId) {
          vm.selectedAccount = vm.accounts.find(function (account) { return account.id === vm.selectedAccountId; });
          vm.selectedBalances = vm.balances.filter(function (row) { return row.account_id === vm.selectedAccountId; }).reverse();
        }
        $timeout(drawChart, 0);
      }).catch(showError);
    }
    function drawChart() {
      if (vm.page !== 'overview' || !vm.balances.length) return;
      var canvas = document.getElementById('balanceChart');
      if (!canvas || !window.Chart) return;
      if (chart) chart.destroy();
      var recordedWeeks = vm.balances.map(function (row) { return row.week_start; }).sort();
      var first = recordedWeeks[0].split('-').map(Number);
      var last = recordedWeeks[recordedWeeks.length - 1].split('-').map(Number);
      var cursor = new Date(Date.UTC(first[0], first[1] - 1, first[2]));
      var end = new Date(Date.UTC(last[0], last[1] - 1, last[2]));
      var weeks = [];
      while (cursor <= end) { weeks.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 7); }
      if (weeks.length > 20) weeks = weeks.slice(-20);
      var datasets = vm.accounts.map(function (account) {
        var rows = vm.balances.filter(function (row) { return row.account_id === account.id; });
        var last = null;
        return { label: account.name, data: weeks.map(function (week) {
          rows.forEach(function (row) { if (row.week_start <= week) last = Number(row.balance); });
          return last;
        }), borderColor: account.color, backgroundColor: account.color, borderWidth: 2.5, tension: 0.35, pointRadius: 3, pointHoverRadius: 6, spanGaps: false };
      });
      chart = new Chart(canvas, {
        type: 'line', data: { labels: weeks.map(function (week) { var p = week.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }), datasets: datasets },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (context) { return context.dataset.label + ': ' + new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y); } } } }, scales: { x: { grid: { display: false }, ticks: { color: '#9197a8', maxTicksLimit: 7 } }, y: { grid: { color: '#eef0f6' }, ticks: { color: '#9197a8', callback: function (value) { return '$' + Number(value).toLocaleString(); } } } } }
      });
    }
    vm.updateSpending = function () {
      var years = new Set([String(new Date().getFullYear()), vm.spendingYear]);
      vm.purchases.forEach(function (purchase) { years.add(purchase.purchase_date.slice(0, 4)); });
      vm.spendingYears = Array.from(years).sort().reverse();
      var prefix = vm.spendingYear + (vm.spendingPeriod === 'month' ? '-' + vm.spendingMonth : '');
      var purchases = vm.purchases.filter(function (purchase) {
        return vm.spendingPeriod === 'all' || purchase.purchase_date.indexOf(prefix) === 0;
      });
      var totals = new Map();
      var totalCents = 0;
      purchases.forEach(function (purchase) {
        var cents = Math.round(Number(purchase.amount) * 100);
        totals.set(purchase.category, (totals.get(purchase.category) || 0) + cents);
        totalCents += cents;
      });
      vm.spendingTotal = totalCents / 100;
      vm.spendingCount = purchases.length;
      vm.spendingLabel = vm.spendingPeriod === 'all' ? 'All time' : vm.spendingPeriod === 'year' ? vm.spendingYear : vm.months[Number(vm.spendingMonth) - 1].name + ' ' + vm.spendingYear;
      vm.spendingCategories = Array.from(totals, function (entry) {
        var index = defaultCategories.indexOf(entry[0]);
        var color = categoryColors[index];
        if (!color) {
          var hash = 0;
          for (var i = 0; i < entry[0].length; i++) hash = (hash * 31 + entry[0].charCodeAt(i)) >>> 0;
          color = 'hsl(' + (hash % 360) + ', 55%, 55%)';
        }
        return { name: entry[0], amount: entry[1] / 100, percentage: totalCents ? entry[1] / totalCents * 100 : 0, color: color };
      }).sort(function (a, b) { return b.amount - a.amount || a.name.localeCompare(b.name); });
      $timeout(drawSpendingChart, 0);
    };
    function drawSpendingChart() {
      if (spendingChart) { spendingChart.destroy(); spendingChart = null; }
      if (vm.page !== 'spending' || !vm.spendingCategories.length) return;
      var canvas = document.getElementById('spendingChart');
      if (!canvas || !window.Chart) return;
      var categories = vm.spendingCategories;
      spendingChart = new Chart(canvas, {
        type: 'pie',
        data: {
          labels: categories.map(function (category) { return category.name; }),
          datasets: [{ data: categories.map(function (category) { return category.amount; }), backgroundColor: categories.map(function (category) { return category.color; }), borderColor: '#fff', borderWidth: 3, hoverOffset: 8 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, layout: { padding: 12 },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: function (context) {
              var category = categories[context.dataIndex];
              return category.name + ': ' + new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(category.amount) + ' (' + category.percentage.toFixed(1) + '%)';
            } } }
          }
        }
      });
    }
    vm.setPage = function (page) {
      if (chart) { chart.destroy(); chart = null; }
      if (spendingChart) { spendingChart.destroy(); spendingChart = null; }
      vm.page = page;
      vm.pageLabel = page.charAt(0).toUpperCase() + page.slice(1);
      vm.error = '';
      if (page === 'accounts' && !vm.selectedAccountId && vm.accounts.length) vm.selectAccount(vm.accounts[0]);
      if (page === 'spending') vm.updateSpending();
      $timeout(drawChart, 0);
    };
    vm.selectAccount = function (account) {
      vm.selectedAccountId = account.id;
      vm.selectedAccount = account;
      vm.selectedBalances = vm.balances.filter(function (row) { return row.account_id === account.id; }).reverse();
      vm.balanceForm = { week: new Date(), balance: account.latest_balance === null ? null : Number(account.latest_balance) };
    };
    vm.openAccount = function () { vm.error = ''; vm.accountForm = { name: '', type: 'Checking', color: '#8676f7', file: null }; vm.modal = 'account'; };
    vm.openPurchase = function () { vm.error = ''; vm.cancelCategory(); vm.purchaseForm = { merchant: '', amount: null, purchase_date: new Date(), category: 'Food & Drink', account_id: null, note: '' }; vm.modal = 'purchase'; };
    vm.closeModal = function () { if (!vm.saving && !vm.categorySaving) vm.modal = null; };
    vm.cancelCategory = function () { vm.creatingCategory = false; vm.categoryName = ''; vm.categoryError = ''; };
    vm.createCategory = function () {
      if (vm.categorySaving || vm.saving) return;
      var name = (vm.categoryName || '').trim();
      vm.categoryError = '';
      if (!name || name.length > 60) { vm.categoryError = 'Enter a category name (up to 60 characters).'; return; }
      vm.categorySaving = true;
      return $http.post('/api/categories', { name: name }).then(function (response) {
        var savedName = response.data.name;
        if (vm.categories.indexOf(savedName) === -1) vm.categories.push(savedName);
        vm.categories.sort(function (a, b) { return a.localeCompare(b); });
        vm.purchaseForm.category = savedName;
        vm.cancelCategory();
        showNotice('Category created and selected.');
      }).catch(function (error) {
        vm.categoryError = error && error.data && error.data.error ? error.data.error : 'Could not create the category. Please try again.';
      }).finally(function () { vm.categorySaving = false; });
    };
    vm.saveAccount = function () {
      vm.saving = true; vm.error = '';
      var data = new FormData();
      data.append('name', vm.accountForm.name);
      data.append('type', vm.accountForm.type);
      data.append('color', vm.accountForm.color);
      if (vm.accountForm.file) data.append('spreadsheet', vm.accountForm.file);
      $http.post('/api/accounts', data, { headers: { 'Content-Type': undefined } }).then(function (response) {
        vm.modal = null;
        showNotice('Account created' + (response.data.imported ? ' with ' + response.data.imported + ' weekly balances.' : '.'));
        return refresh().then(function () { var account = vm.accounts.find(function (item) { return item.id === response.data.id; }); if (account) vm.selectAccount(account); vm.setPage('accounts'); });
      }).catch(showError).finally(function () { vm.saving = false; });
    };
    vm.saveBalance = function () {
      vm.saving = true; vm.error = '';
      $http.post('/api/accounts/' + vm.selectedAccountId + '/balances', { week: localDate(vm.balanceForm.week), balance: vm.balanceForm.balance }).then(function () { showNotice('Weekly balance saved.'); return refresh(); }).catch(showError).finally(function () { vm.saving = false; });
    };
    vm.savePurchase = function () {
      if (vm.saving || vm.categorySaving || vm.creatingCategory) return;
      vm.saving = true; vm.error = '';
      var form = angular.copy(vm.purchaseForm);
      form.purchase_date = localDate(vm.purchaseForm.purchase_date);
      $http.post('/api/purchases', form).then(function () { vm.modal = null; showNotice('Purchase saved.'); return refresh(); }).catch(showError).finally(function () { vm.saving = false; });
    };
    vm.deletePurchase = function (purchase) {
      if (!window.confirm('Delete this purchase from your history?')) return;
      vm.error = '';
      $http.delete('/api/purchases/' + purchase.id).then(function () { showNotice('Purchase deleted.'); return refresh(); }).catch(showError);
    };
    $scope.$on('$destroy', function () { if (chart) chart.destroy(); if (spendingChart) spendingChart.destroy(); });
    refresh();
  });
}());
