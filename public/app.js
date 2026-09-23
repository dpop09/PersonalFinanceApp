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
      return Promise.all([$http.get('/api/accounts'), $http.get('/api/balances'), $http.get('/api/purchases')]).then(function (results) {
        vm.accounts = results[0].data;
        vm.balances = results[1].data;
        vm.purchases = results[2].data;
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
    vm.setPage = function (page) {
      vm.page = page;
      vm.pageLabel = page.charAt(0).toUpperCase() + page.slice(1);
      vm.error = '';
      if (page === 'accounts' && !vm.selectedAccountId && vm.accounts.length) vm.selectAccount(vm.accounts[0]);
      $timeout(drawChart, 0);
    };
    vm.selectAccount = function (account) {
      vm.selectedAccountId = account.id;
      vm.selectedAccount = account;
      vm.selectedBalances = vm.balances.filter(function (row) { return row.account_id === account.id; }).reverse();
      vm.balanceForm = { week: new Date(), balance: account.latest_balance === null ? null : Number(account.latest_balance) };
    };
    vm.openAccount = function () { vm.error = ''; vm.accountForm = { name: '', type: 'Checking', color: '#8676f7', file: null }; vm.modal = 'account'; };
    vm.openPurchase = function () { vm.error = ''; vm.purchaseForm = { merchant: '', amount: null, purchase_date: new Date(), category: 'Food & Drink', account_id: null, note: '' }; vm.modal = 'purchase'; };
    vm.closeModal = function () { if (!vm.saving) vm.modal = null; };
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
    $scope.$on('$destroy', function () { if (chart) chart.destroy(); });
    refresh();
  });
}());
