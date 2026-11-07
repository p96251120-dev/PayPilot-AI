
import React, { useState, useEffect, useMemo } from "react";
import "./App.css";
import {
  IconOverview,
  IconInvoices,
  IconPayments,
  IconCustomers,
  IconAI,
  IconReports,
  IconSettings,
  IconSearch,
  IconPlus,
  IconFilter,
  IconSort,
  IconCheck,
  IconCheckCircle,
  IconAlert,
  IconClock,
  IconCalendar,
  IconDownload,
  IconTrash,
  IconEdit,
  IconExternal,
  IconArrowRight,
  IconClose,
  IconMenu,
  IconRefresh,
  IconEye,
  IconShield,
  IconZap,
  IconCopy,
  IconChevronDown
} from "./Icons";

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultDueDate(daysAhead = 30) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isInvoiceOverdue(invoice, overrideToday = null) {
  if (!invoice || typeof invoice !== "object") return false;
  const status = (invoice.status || "").toLowerCase().trim();
  if (status === "paid") return false;
  if (!invoice.due_date || typeof invoice.due_date !== "string" || !invoice.due_date.trim()) {
    return false;
  }
  const cleanDueDate = invoice.due_date.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDueDate)) {
    return false;
  }
  const todayStr = (typeof overrideToday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(overrideToday.trim()))
    ? overrideToday.trim()
    : getTodayDateString();
  return cleanDueDate < todayStr;
}

function App() {
  const [page, setPage] = useState(() => {
    try {
      const qp = new URLSearchParams(window.location.search).get("page");
      if (qp) {
        const found = ["Overview", "Invoices", "Payments", "Customers", "AI Copilot", "Reports", "Settings", "Create Invoice"].find(
          p => p.toLowerCase() === qp.toLowerCase() || p.toLowerCase().replace(/\s+/g, "") === qp.toLowerCase().replace(/\s+/g, "")
        );
        if (found) return found;
      }
      const hash = window.location.hash.replace("#", "");
      if (hash) {
        const found = ["Overview", "Invoices", "Payments", "Customers", "AI Copilot", "Reports", "Settings", "Create Invoice"].find(
          p => p.toLowerCase() === hash.toLowerCase() || p.toLowerCase().replace(/\s+/g, "") === hash.toLowerCase().replace(/\s+/g, "")
        );
        if (found) return found;
      }
    } catch (e) {}
    return "Overview";
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [previousPage, setPreviousPage] = useState("Overview");

  function navigateTo(newPage, options = {}) {
    if (page !== newPage) {
      setPreviousPage(page);
      setPage(newPage);
    }
    if (options.customerId !== undefined) {
      setViewingCustomerId(options.customerId);
    } else if (newPage !== "Customers") {
      setViewingCustomerId(null);
    }
    setMobileMenuOpen(false);

    try {
      const currentParams = new URLSearchParams(window.location.search);
      currentParams.set("page", newPage);
      if (options.customerId) {
        currentParams.set("customer", options.customerId);
      } else {
        currentParams.delete("customer");
      }
      const newUrl = `${window.location.pathname}?${currentParams.toString()}`;
      if (options.replace) {
        window.history.replaceState({ page: newPage, customerId: options.customerId || null }, "", newUrl);
      } else {
        window.history.pushState({ page: newPage, customerId: options.customerId || null }, "", newUrl);
      }
    } catch (e) {}
  }

  function handleBack() {
    if (viewingCustomerId) {
      setViewingCustomerId(null);
      navigateTo("Customers", { replace: true });
      return;
    }
    if (page === "Create Invoice") {
      navigateTo(previousPage || "Invoices");
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigateTo("Overview");
    }
  }
  const [systemHealth, setSystemHealth] = useState({
    paypal_configured: false,
    paypal_mode: "sandbox",
    status: "healthy"
  });
  const [customer, setCustomer] = useState("");
  const [email, setEmail] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("INV-1001");
  const [items, setItems] = useState([
    { description: "", quantity: 1, price: 0 }
  ]);
  const [savedInvoices, setSavedInvoices] = useState([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [invoicesError, setInvoicesError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sortBy, setSortBy] = useState("date-desc");
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [aiPrompt, setAiPrompt] = useState("");
const [aiLoading, setAiLoading] = useState(false);
const [aiResult, setAiResult] = useState(null);
const [aiError, setAiError] = useState("");
const [aiSuccessMessage, setAiSuccessMessage] = useState("");
const [copilotQuery, setCopilotQuery] = useState("");
const [copilotLoading, setCopilotLoading] = useState(false);
const [copilotError, setCopilotError] = useState("");
const [copilotResult, setCopilotResult] = useState(null);
const [productQuery, setProductQuery] = useState("");
const [products, setProducts] = useState([]);
const [productLoading, setProductLoading] = useState(false);
const [productError, setProductError] = useState("");
const [exactProducts, setExactProducts] = useState([]);
const [similarProducts, setSimilarProducts] = useState([]);
const [relatedProducts, setRelatedProducts] = useState([]);
const [paymentLoading, setPaymentLoading] = useState(false);
const [paymentNotification, setPaymentNotification] = useState(null);
  const [invoiceCurrency, setInvoiceCurrency] = useState("USD");
  const [dueDate, setDueDate] = useState(getDefaultDueDate(30));
  const [payments, setPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [paymentsError, setPaymentsError] = useState("");
  const [paymentSearchTerm, setPaymentSearchTerm] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("All");
  const [paymentSortBy, setPaymentSortBy] = useState("date-desc");
  const [customers, setCustomers] = useState([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [customersError, setCustomersError] = useState("");
  const [customerSearchTerm, setCustomerSearchTerm] = useState("");
  const [viewingCustomerId, setViewingCustomerId] = useState(null);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [customerFormData, setCustomerFormData] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    address: "",
    notes: ""
  });
  const [customerFormError, setCustomerFormError] = useState("");
  const [customerSubmitting, setCustomerSubmitting] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [reportsAnalytics, setReportsAnalytics] = useState(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState("");
  const [reportsDateRange, setReportsDateRange] = useState("all");
  const [reportsCurrencyFilter, setReportsCurrencyFilter] = useState("all");
  const [appSettings, setAppSettings] = useState({
    business_name: "PayPilot Merchant",
    business_email: "billing@paypilot.ai",
    business_phone: "+1 (555) 019-2834",
    business_address: "77 Market Street, Suite 500, San Francisco, CA 94105",
    tax_id: "US-TAX-8829103",
    default_currency: "USD",
    default_due_days: 30,
    invoice_prefix: "INV-",
    default_notes: "Thank you for your business. Payment is due within the terms specified."
  });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSuccessMsg, setSettingsSuccessMsg] = useState("");
  const [settingsErrorMsg, setSettingsErrorMsg] = useState("");

useEffect(() => {
  loadInvoices();
  loadPayments();
  loadCustomers();
  loadAppSettings();
  loadReportsAnalytics("all", "all");
  handlePaymentReturn();
  loadHealthStatus();

  function handlePopState(e) {
    try {
      const qp = new URLSearchParams(window.location.search).get("page");
      const custId = new URLSearchParams(window.location.search).get("customer");
      let target = "Overview";
      if (qp) {
        const found = ["Overview", "Invoices", "Payments", "Customers", "AI Copilot", "Reports", "Settings", "Create Invoice"].find(
          p => p.toLowerCase() === qp.toLowerCase() || p.toLowerCase().replace(/\s+/g, "") === qp.toLowerCase().replace(/\s+/g, "")
        );
        if (found) target = found;
      } else if (e.state && e.state.page) {
        target = e.state.page;
      }
      setPage(target);
      setViewingCustomerId(custId ? (parseInt(custId, 10) || custId) : null);
    } catch (err) {}
  }

  window.addEventListener("popstate", handlePopState);
  return () => window.removeEventListener("popstate", handlePopState);
}, []);

  async function loadHealthStatus() {
    try {
      const resp = await fetch("http://127.0.0.1:8000/health");
      if (resp.ok) {
        const data = await resp.json();
        setSystemHealth(data);
      }
    } catch (e) {
      console.warn("Health check unreachable:", e);
    }
  }

  useEffect(() => {
    try {
      const st = new URLSearchParams(window.location.search).get("scrollTop");
      if (st) {
        const timer = setTimeout(() => {
          const mainEl = document.querySelector(".main");
          if (mainEl) {
            mainEl.scrollTop = parseInt(st, 10);
          }
        }, 300);
        return () => clearTimeout(timer);
      }
    } catch (e) {}
  }, [savedInvoices, page]);

  async function loadReportsAnalytics(range = reportsDateRange, curr = reportsCurrencyFilter) {
    setReportsLoading(true);
    setReportsError("");

    let startDate = "";
    let endDate = "";
    const now = new Date();

    if (range === "30d") {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      startDate = d.toISOString().slice(0, 10);
    } else if (range === "90d") {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      startDate = d.toISOString().slice(0, 10);
    } else if (range === "year") {
      startDate = `${now.getFullYear()}-01-01`;
    }

    const params = new URLSearchParams();
    if (startDate) params.append("start_date", startDate);
    if (endDate) params.append("end_date", endDate);
    if (curr && curr !== "all") params.append("currency", curr);

    try {
      const url = `http://127.0.0.1:8000/api/reports/analytics?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load reports: ${response.statusText}`);
      }
      const data = await response.json();
      setReportsAnalytics(data);
      return data;
    } catch (err) {
      console.error("Error loading analytics:", err);
      setReportsError(err.message || "Failed to load reports data");
      return null;
    } finally {
      setReportsLoading(false);
    }
  }

  function handleExportCsv() {
    let startDate = "";
    const now = new Date();
    if (reportsDateRange === "30d") {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      startDate = d.toISOString().slice(0, 10);
    } else if (reportsDateRange === "90d") {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      startDate = d.toISOString().slice(0, 10);
    } else if (reportsDateRange === "year") {
      startDate = `${now.getFullYear()}-01-01`;
    }

    const params = new URLSearchParams();
    if (startDate) params.append("start_date", startDate);
    if (reportsCurrencyFilter && reportsCurrencyFilter !== "all") {
      params.append("currency", reportsCurrencyFilter);
    }

    window.open(`http://127.0.0.1:8000/api/reports/export-csv?${params.toString()}`, "_blank");
  }

  async function loadAppSettings() {
    setSettingsLoading(true);
    try {
      const resp = await fetch("http://127.0.0.1:8000/api/settings");
      if (resp.ok) {
        const data = await resp.json();
        setAppSettings(data);
        return data;
      }
    } catch (e) {
      console.error("Error loading app settings:", e);
    } finally {
      setSettingsLoading(false);
    }
    return null;
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    setSettingsSaving(true);
    setSettingsSuccessMsg("");
    setSettingsErrorMsg("");

    try {
      const resp = await fetch("http://127.0.0.1:8000/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(appSettings)
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.detail || "Failed to update settings");
      }
      setAppSettings(data);
      setSettingsSuccessMsg("Invoicing and business settings saved successfully.");
      setTimeout(() => setSettingsSuccessMsg(""), 4000);
    } catch (err) {
      setSettingsErrorMsg(err.message || "Failed to save settings");
    } finally {
      setSettingsSaving(false);
    }
  }

  async function loadCustomers() {
    setCustomersLoading(true);
    setCustomersError("");
    try {
      const response = await fetch("http://127.0.0.1:8000/api/customers");
      if (!response.ok) {
        throw new Error(`Failed to load customers: ${response.statusText}`);
      }
      const data = await response.json();
      setCustomers(Array.isArray(data) ? data : []);
      return data;
    } catch (err) {
      console.error("Error loading customers:", err);
      setCustomersError(err.message || "Could not load customers");
      return [];
    } finally {
      setCustomersLoading(false);
    }
  }

  function openCustomerModal(cust = null) {
    setCustomerFormError("");
    if (cust) {
      setEditingCustomer(cust);
      setCustomerFormData({
        name: cust.name || "",
        email: cust.email || "",
        phone: cust.phone || "",
        company: cust.company || "",
        address: cust.address || "",
        notes: cust.notes || ""
      });
    } else {
      setEditingCustomer(null);
      setCustomerFormData({
        name: "",
        email: "",
        phone: "",
        company: "",
        address: "",
        notes: ""
      });
    }
    setIsCustomerModalOpen(true);
  }

  function closeCustomerModal() {
    setIsCustomerModalOpen(false);
    setEditingCustomer(null);
    setCustomerFormError("");
  }

  async function handleCustomerFormSubmit(e) {
    e.preventDefault();
    setCustomerFormError("");
    setCustomerSubmitting(true);

    const isEdit = Boolean(editingCustomer);
    const url = isEdit
      ? `http://127.0.0.1:8000/api/customers/${editingCustomer.id}`
      : "http://127.0.0.1:8000/api/customers";
    const method = isEdit ? "PUT" : "POST";

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(customerFormData)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Failed to save customer");
      }
      closeCustomerModal();
      await loadCustomers();
      if (!isEdit && page === "Create Invoice") {
        setSelectedCustomerId(data.id);
        setCustomer(data.name);
        setEmail(data.email);
      }
    } catch (err) {
      setCustomerFormError(err.message);
    } finally {
      setCustomerSubmitting(false);
    }
  }

  async function handleDeleteCustomer(cust) {
    if (!cust) return;
    const confirmDelete = window.confirm(
      `Are you sure you want to delete customer "${cust.name}" (${cust.email})?`
    );
    if (!confirmDelete) return;

    try {
      const response = await fetch(`http://127.0.0.1:8000/api/customers/${cust.id}`, {
        method: "DELETE"
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Failed to delete customer");
      }
      if (viewingCustomerId === cust.id) {
        setViewingCustomerId(null);
      }
      await loadCustomers();
      alert("Customer deleted successfully.");
    } catch (err) {
      alert(`Deletion restricted: ${err.message}`);
    }
  }

  async function loadPayments() {
    setPaymentsLoading(true);
    setPaymentsError("");
    try {
      const response = await fetch("http://127.0.0.1:8000/api/payments");
      if (!response.ok) {
        throw new Error(`Failed to load payments: ${response.statusText}`);
      }
      const data = await response.json();
      setPayments(Array.isArray(data) ? data : []);
      return data;
    } catch (err) {
      console.error("Error loading payments:", err);
      setPaymentsError(err.message || "Could not load payments");
      return [];
    } finally {
      setPaymentsLoading(false);
    }
  }

  async function handlePaymentReturn() {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get("payment");
    const invoiceId = urlParams.get("invoiceId");
    const orderId = urlParams.get("token");

    if (!paymentStatus) return;

    window.history.replaceState({}, document.title, window.location.pathname);

    if (paymentStatus === "success" && orderId && invoiceId) {
      setPaymentLoading(true);
      setPaymentNotification({
        type: "info",
        message: `Verifying and capturing PayPal payment for invoice ${invoiceId}...`
      });

      try {
        const response = await fetch("http://127.0.0.1:8000/api/payments/capture-order", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            order_id: orderId,
            invoice_id: invoiceId
          })
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.detail || "Payment capture failed.");
        }

        await loadInvoices();
        await loadPayments();
        setPage("Invoices");
        setPaymentNotification({
          type: "success",
          message: `Payment successful! Invoice ${invoiceId} has been marked as Paid. (Transaction Ref: ${data.capture_id || orderId})`
        });
      } catch (err) {
        await loadPayments();
        setPaymentNotification({
          type: "error",
          message: `Payment capture error: ${err.message}`
        });
      } finally {
        setPaymentLoading(false);
      }
    } else if (paymentStatus === "cancel") {
      if (invoiceId) {
        fetch("http://127.0.0.1:8000/api/payments/record-cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoice_id: invoiceId, order_id: orderId || null })
        }).then(() => {
          loadInvoices();
          loadPayments();
        }).catch(err => console.error("Error recording cancel:", err));
      }
      setPaymentNotification({
        type: "warning",
        message: `PayPal payment was cancelled. Invoice ${invoiceId || ""} was not charged.`
      });
    }
  }

  async function initiatePayPalCheckout(invoice) {
    if (invoice.status === "Paid") {
      alert("This invoice is already paid.");
      return;
    }

    if (Number(invoice.total || 0) <= 0) {
      alert("Invoice total must be greater than zero to checkout with PayPal.");
      return;
    }

    setPaymentLoading(true);
    try {
      const response = await fetch(`http://127.0.0.1:8000/api/payments/create-order/${invoice.id}`, {
        method: "POST"
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Unable to initiate PayPal checkout.");
      }

      if (data.approval_url) {
        window.location.href = data.approval_url;
      } else {
        throw new Error("No PayPal approval URL returned by the server.");
      }
    } catch (err) {
      alert(`PayPal checkout error: ${err.message}`);
      setPaymentLoading(false);
    }
  }

async function deleteInvoice(invoiceId) {
  const confirmDelete = window.confirm(
    "Are you sure you want to delete this invoice?"
  );

  if (!confirmDelete) return;

  try {
    const response = await fetch(
      `http://127.0.0.1:8000/api/invoices/${invoiceId}`,
      {
        method: "DELETE"
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Invoice could not be deleted.");
    }

    alert("Invoice deleted successfully!");

    await loadInvoices();

  } catch (error) {
    alert(error.message || "Unable to delete invoice.");
  }
}

  const total = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0),
    0
  );

  function updateItem(index, field, value) {
    setItems(old =>
      old.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    );
  }

  function addItem() {
    setItems(old => [...old, { description: "", quantity: 1, price: 0 }]);
  }

  async function generateAIInvoice() {
    if (!aiPrompt.trim()) {
      setAiError("Please describe your invoice first.");
      return;
    }

    setAiLoading(true);
    setAiError("");
    setAiSuccessMessage("");

    try {
      const response = await fetch("http://127.0.0.1:8000/api/ai/generate-invoice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ prompt: aiPrompt })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Unable to parse invoice details from prompt.");
      }

      setAiResult(data);
    } catch (err) {
      setAiError(err.message || "Unable to connect to AI invoice service.");
    } finally {
      setAiLoading(false);
    }
  }

  function updatePreviewField(field, value) {
    if (!aiResult) return;
    setAiResult(prev => ({
      ...prev,
      [field]: value
    }));
  }

  function updatePreviewItem(index, field, value) {
    if (!aiResult) return;
    setAiResult(prev => {
      const newItems = prev.items.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, [field]: value };
        const qty = Number(updated.quantity || 0);
        const pr = Number(updated.price || 0);
        updated.total = Math.round(qty * pr * 100) / 100;
        return updated;
      });
      const newGrandTotal = newItems.reduce((acc, it) => acc + (it.total || 0), 0);
      return {
        ...prev,
        items: newItems,
        total: Math.round(newGrandTotal * 100) / 100
      };
    });
  }

  function addPreviewItem() {
    if (!aiResult) return;
    setAiResult(prev => ({
      ...prev,
      items: [...(prev.items || []), { description: "", quantity: 1, price: 0, total: 0 }]
    }));
  }

  function removePreviewItem(index) {
    if (!aiResult || (aiResult.items && aiResult.items.length <= 1)) return;
    setAiResult(prev => {
      const newItems = prev.items.filter((_, i) => i !== index);
      const newGrandTotal = newItems.reduce((acc, it) => acc + (it.total || 0), 0);
      return {
        ...prev,
        items: newItems,
        total: Math.round(newGrandTotal * 100) / 100
      };
    });
  }

  function transferGeneratedInvoiceToForm() {
    if (!aiResult) return;

    // Validate extracted data before transferring
    const targetCustomer = aiResult.customer || "";
    const targetEmail = aiResult.email || "";
    const targetCurrency = aiResult.currency || "USD";
    const rawItems = aiResult.items && aiResult.items.length > 0 ? aiResult.items : [];

    const validItems = rawItems.map(it => ({
      description: it.description || "Item",
      quantity: Math.max(1, Number(it.quantity) || 1),
      price: Math.max(0, Number(it.price) || 0)
    }));

    if (validItems.length === 0) {
      validItems.push({ description: "", quantity: 1, price: 0 });
    }

    setCustomer(targetCustomer);
    setEmail(targetEmail);
    setInvoiceCurrency(targetCurrency);
    if (aiResult.due_date) {
      setDueDate(aiResult.due_date);
    } else if (!dueDate) {
      setDueDate(getDefaultDueDate(30));
    }
    setItems(validItems);

    setPage("Create Invoice");
    setAiSuccessMessage("✓ Invoice details transferred to form! Review below and click 'Create invoice' to save.");

    // Scroll smoothly to the invoice form
    setTimeout(() => {
      document.getElementById("invoice-details-form")?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }

  function discardAIResult() {
    setAiResult(null);
    setAiError("");
    setAiSuccessMessage("");
  }

  const copilotSuggestions = [
    "What is my total revenue?",
    "Which customers have pending invoices?",
    "Show overdue invoices",
    "What should I do next?"
  ];

  async function askCopilot(nextQuery) {
    const q = (typeof nextQuery === "string" ? nextQuery : copilotQuery).trim();
    if (!q) {
      setCopilotError("Enter a question about your invoices, payments, or customers.");
      return;
    }

    setCopilotQuery(q);
    setCopilotLoading(true);
    setCopilotError("");

    try {
      const response = await fetch("http://127.0.0.1:8000/api/ai/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || "The copilot could not answer that question.");
      }
      setCopilotResult(data);
    } catch (err) {
      setCopilotResult(null);
      setCopilotError(err.message || "Unable to reach the copilot service.");
    } finally {
      setCopilotLoading(false);
    }
  }

  function applyCopilotSuggestion(suggestion) {
    if (!suggestion) return;
    const action = suggestion.action_type;
    const target = suggestion.target_page || "Invoices";

    if (action === "transfer_draft") {
      const draft = copilotResult && copilotResult.draft_invoice;
      if (!draft) return;
      setAiResult(draft);
      setAiError("");
      setAiSuccessMessage("");
      setTimeout(() => {
        document.getElementById("ai-invoice-preview")?.scrollIntoView({ behavior: "smooth" });
      }, 50);
      return;
    }

    if (action !== "navigate" && action !== "filter_invoices") return;

    if (suggestion.filter_status === "Overdue") {
      setOverdueOnly(true);
      setStatusFilter("All");
      setSearchTerm(suggestion.search_term || "");
      setPage("Invoices");
      return;
    }

    setOverdueOnly(false);
    if (action === "filter_invoices") {
      setSearchTerm(suggestion.search_term || "");
      setStatusFilter("All");
    } else {
      const known = ["Draft", "Pending", "Paid", "All"];
      if (known.includes(suggestion.filter_status)) {
        setStatusFilter(suggestion.filter_status);
      }
      if (suggestion.search_term) setSearchTerm(suggestion.search_term);
    }
    setPage(target);
  }

  function renderAIGenerator() {
    return (
      <div className="ai-workspace-container">
        {/* Top Diagnostic Engine Bar */}
        <div className="ai-diagnostic-bar">
          <div className="ai-diag-item active">
            <span className="diag-dot emerald"></span>
            <span>Deterministic NLP Engine: <strong>Active</strong></span>
          </div>
          <div className="ai-diag-item">
            <span className="diag-icon">⚡</span>
            <span>Latency: <strong>~17ms (Instant)</strong></span>
          </div>
          <div className="ai-diag-item">
            <span className="diag-icon"><IconShield width={13} height={13} /></span>
            <span>Privacy: <strong>100% Offline Safe</strong></span>
          </div>
          <div className="ai-diag-item">
            <span className="diag-icon"><IconZap width={13} height={13} /></span>
            <span>Token Cost: <strong>$0.00 / Zero</strong></span>
          </div>
        </div>

        {/* 2-Column Split Terminal Workspace */}
        <div className="ai-terminal-grid">
          {/* Left Column: Prompt Console */}
          <div className="panel ai-console-panel">
            <div className="ai-console-header">
              <div className="console-title-group">
                <div className="console-prompt-badge">{">_"}</div>
                <div>
                  <h3>Financial Prompt Console</h3>
                  <p>Parse natural language billing instructions into structured invoices</p>
                </div>
              </div>
              <span className="console-status-pill">LOCAL PARSER</span>
            </div>

            <div className="console-editor-wrap">
              <textarea
                className="ai-terminal-textarea"
                value={aiPrompt}
                onChange={e => {
                  setAiPrompt(e.target.value);
                  if (aiError) setAiError("");
                }}
                placeholder="Example: Create an invoice for Rahul, email rahul@example.com. 2 keyboards at $25 each and 1 mouse at $15."
                rows="4"
              />
            </div>

            <div className="ai-prompt-presets">
              <span className="presets-label">Prompt Presets:</span>
              <div className="presets-chips-grid">
                <button
                  type="button"
                  className="preset-chip"
                  onClick={() => setAiPrompt("Create an invoice for Rahul, email rahul@example.com. 2 keyboards at $25 each and 1 mouse at $15.")}
                >
                  <span className="chip-tag">USD</span>
                  <span>Hardware & Email (Rahul)</span>
                </button>
                <button
                  type="button"
                  className="preset-chip"
                  onClick={() => setAiPrompt("Create an invoice for Rahul Sharma for 2 website designs at $300 each.")}
                >
                  <span className="chip-tag">USD</span>
                  <span>Website Designs ($600)</span>
                </button>
                <button
                  type="button"
                  className="preset-chip"
                  onClick={() => setAiPrompt("Bill Priya Verma, email priya@verma.com: 5 logo designs at €50 each.")}
                >
                  <span className="chip-tag">EUR</span>
                  <span>Logo Design (€250)</span>
                </button>
                <button
                  type="button"
                  className="preset-chip"
                  onClick={() => setAiPrompt("Invoice for Alex Morgan, email alex@example.com: 3 consulting sessions at £100 each.")}
                >
                  <span className="chip-tag">GBP</span>
                  <span>Consulting Sessions (£300)</span>
                </button>
              </div>
            </div>

            {aiError && (
              <div className="ai-error-banner">
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><IconAlert width={15} height={15} /> {aiError}</span>
                <button type="button" onClick={() => setAiError("")} aria-label="Dismiss error"><IconClose width={14} height={14} /></button>
              </div>
            )}

            {aiSuccessMessage && (
              <div className="ai-success-banner">
                <span>{aiSuccessMessage}</span>
                <button type="button" onClick={() => setAiSuccessMessage("")} aria-label="Dismiss notification"><IconClose width={14} height={14} /></button>
              </div>
            )}

            <div className="console-action-row">
              <button
                type="button"
                className="create-btn ai-generate-action-btn"
                onClick={generateAIInvoice}
                disabled={aiLoading}
              >
                {aiLoading ? (
                  <>
                    <div className="spinner-small white"></div>
                    <span>Analyzing & Parsing...</span>
                  </>
                ) : (
                  <>
                    <IconZap width={16} height={16} />
                    <span>Generate Invoice with AI →</span>
                  </>
                )}
              </button>
              {aiPrompt && (
                <button
                  type="button"
                  className="period-btn"
                  onClick={() => setAiPrompt("")}
                >
                  Clear Prompt
                </button>
              )}
            </div>

            <div className="ai-engine-capabilities-card">
              <h5>Parser Capabilities</h5>
              <ul>
                <li><strong>Entity Detection:</strong> Extracts client name, normalized email, and currency symbols.</li>
                <li><strong>Line Item Extraction:</strong> Identifies quantities, item descriptions, and unit prices.</li>
                <li><strong>Multi-Currency:</strong> Full support for USD ($), EUR (€), GBP (£), INR (₹), CAD, AUD.</li>
                <li><strong>Safe Verification:</strong> Flags missing required fields before database commits.</li>
              </ul>
            </div>
          </div>

          {/* Right Column: Invoice Sheet Preview */}
          <div className="panel ai-preview-panel" id="ai-invoice-preview">
            {!aiResult ? (
              <div className="ai-blueprint-placeholder">
                <div className="blueprint-watermark">
                  <IconInvoices width={48} height={48} />
                </div>
                <h4>Extracted Invoice Blueprint</h4>
                <p>Awaiting natural language billing instructions from the console.</p>
                <div className="blueprint-demo-sheet">
                  <div className="blueprint-line header"></div>
                  <div className="blueprint-line short"></div>
                  <div className="blueprint-row">
                    <div className="blueprint-box"></div>
                    <div className="blueprint-box"></div>
                  </div>
                  <div className="blueprint-table-lines">
                    <div className="blueprint-line"></div>
                    <div className="blueprint-line"></div>
                    <div className="blueprint-line"></div>
                  </div>
                </div>
                <span className="blueprint-hint">
                  Type a prompt on the left or click any preset to generate an itemized invoice.
                </span>
              </div>
            ) : (
              <div className="ai-preview-content">
                <div className="ai-preview-sheet-header">
                  <div>
                    <span className="sheet-badge">STRUCTURED PREVIEW</span>
                    <h4>Extracted Invoice Sheet</h4>
                  </div>
                  <div className="sheet-badges-row">
                    <span className="ai-engine-badge">
                      {aiResult.engine_badge || "⚡ Deterministic NLP Parser"}
                    </span>
                    <span className={`ai-status-badge ${aiResult.is_complete ? "complete" : "incomplete"}`}>
                      {aiResult.is_complete ? "● Ready to Transfer" : "⚠️ Incomplete Details"}
                    </span>
                  </div>
                </div>

                {aiResult.missing_fields && aiResult.missing_fields.length > 0 && (
                  <div className="ai-missing-alert">
                    <h5 style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <IconAlert width={15} height={15} /> Required details missing from prompt:
                    </h5>
                    <ul>
                      {aiResult.missing_fields.map((mf, idx) => (
                        <li key={idx}>{mf}</li>
                      ))}
                    </ul>
                    <p>You can fill them in below or transfer to the invoice form.</p>
                  </div>
                )}

                <div className="ai-sheet-client-fields">
                  <div className="ai-preview-field">
                    <label>Customer Name</label>
                    <input
                      type="text"
                      value={aiResult.customer || ""}
                      placeholder="e.g. Rahul Sharma"
                      onChange={e => updatePreviewField("customer", e.target.value)}
                    />
                  </div>

                  <div className="ai-preview-field">
                    <label>Customer Email</label>
                    <input
                      type="email"
                      value={aiResult.email || ""}
                      placeholder="e.g. rahul@example.com"
                      onChange={e => updatePreviewField("email", e.target.value)}
                    />
                  </div>

                  <div className="ai-preview-field">
                    <label>Currency</label>
                    <select
                      value={aiResult.currency || "USD"}
                      onChange={e => updatePreviewField("currency", e.target.value)}
                    >
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="INR">INR (₹)</option>
                      <option value="CAD">CAD ($)</option>
                      <option value="AUD">AUD ($)</option>
                    </select>
                  </div>

                  <div className="ai-preview-field">
                    <label>Due Date</label>
                    <input
                      type="date"
                      value={aiResult.due_date || ""}
                      onChange={e => updatePreviewField("due_date", e.target.value)}
                    />
                  </div>
                </div>

                <div className="ai-preview-items-section">
                  <h5>Itemized Line Items</h5>
                  <table className="ai-preview-table">
                    <thead>
                      <tr>
                        <th style={{ width: "45%" }}>Description</th>
                        <th style={{ width: "15%" }}>Qty</th>
                        <th style={{ width: "20%" }}>Price ({aiResult.currency || "USD"})</th>
                        <th style={{ width: "15%" }}>Amount</th>
                        <th style={{ width: "5%" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {aiResult.items && aiResult.items.map((item, idx) => (
                        <tr key={idx}>
                          <td>
                            <input
                              type="text"
                              value={item.description || ""}
                              placeholder="Item description"
                              onChange={e => updatePreviewItem(idx, "description", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity || 1}
                              onChange={e => updatePreviewItem(idx, "quantity", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.price !== null && item.price !== undefined ? item.price : ""}
                              placeholder="0.00"
                              onChange={e => updatePreviewItem(idx, "price", e.target.value)}
                            />
                          </td>
                          <td style={{ fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                            {formatCurrency(Number(item.quantity || 0) * Number(item.price || 0), aiResult.currency)}
                          </td>
                          <td>
                            {aiResult.items.length > 1 && (
                              <button
                                type="button"
                                className="remove-item-btn"
                                onClick={() => removePreviewItem(idx)}
                                title="Remove item"
                              ><IconClose width={14} height={14} /></button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <button
                    type="button"
                    className="add-item-btn"
                    onClick={addPreviewItem}
                  >
                    <IconPlus width={14} height={14} /> Add Line Item
                  </button>
                </div>

                <div className="ai-preview-total-row">
                  <span>Grand Total:</span>
                  <strong>{formatCurrency(aiResult.total, aiResult.currency)}</strong>
                </div>

                <div className="ai-preview-footer-actions">
                  <button
                    type="button"
                    className="discard-btn"
                    onClick={discardAIResult}
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    className="transfer-btn"
                    onClick={transferGeneratedInvoiceToForm}
                  >
                    Transfer to Form →
                  </button>
                  <button
                    type="button"
                    className="create-btn direct-save-btn"
                    onClick={async () => {
                      if (!aiResult.customer || !aiResult.customer.trim()) {
                        alert("Customer Name is required to save invoice.");
                        return;
                      }
                      if (!aiResult.email || !aiResult.email.trim()) {
                        alert("Customer Email is required to save invoice.");
                        return;
                      }
                      if (!aiResult.items || aiResult.items.length === 0) {
                        alert("At least one line item is required.");
                        return;
                      }
                      const hasValidItem = aiResult.items.some(
                        it => it.description && it.description.trim() && it.price !== null && it.price !== undefined
                      );
                      if (!hasValidItem) {
                        alert("Please provide at least one valid item with a description and price.");
                        return;
                      }
                      try {
                        const calculatedTotal = aiResult.items.reduce((acc, it) => {
                          const q = Number(it.quantity) || 1;
                          const p = Number(it.price) || 0;
                          return acc + (q * p);
                        }, 0);
                        const nextId = "INV-" + Date.now().toString().slice(-4);
                        const newInvoice = {
                          id: nextId,
                          customer: aiResult.customer.trim(),
                          email: aiResult.email.trim(),
                          items: aiResult.items,
                          total: Math.round(calculatedTotal * 100) / 100,
                          status: "Draft",
                          currency: aiResult.currency || "USD",
                          due_date: aiResult.due_date || getDefaultDueDate(30)
                        };
                        const resp = await fetch("http://127.0.0.1:8000/api/invoices", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(newInvoice)
                        });
                        if (resp.ok) {
                          discardAIResult();
                          await loadInvoices();
                          setPage("Invoices");
                          alert(`Draft Invoice ${nextId} created directly from AI Copilot!`);
                        } else {
                          const errData = await resp.json().catch(() => ({}));
                          alert("Failed to save draft invoice: " + (errData.detail || resp.statusText));
                        }
                      } catch (err) {
                        alert("Error saving invoice: " + err.message);
                      }
                    }}
                  >
                    Save as Draft Invoice
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }


  async function searchProducts() {
  if (!productQuery.trim()) {
    setProductError("Please enter a product name.");
    return;
  }

  setProductLoading(true);
  setProductError("");

  setProducts([]);
  setExactProducts([]);
  setSimilarProducts([]);
  setRelatedProducts([]);

  try {
    const response = await fetch(
      "http://127.0.0.1:8000/api/products/search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: productQuery
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Product search failed.");
    }

    const allProducts = data.products || [];

    const normalize = (text) =>
      (text || "").toLowerCase().match(/[a-z0-9]+/g) || [];

    const queryWords = normalize(productQuery);
    const queryText = queryWords.join(" ");

    // Calculate spelling similarity using edit distance
    function similarity(a, b) {
      if (!a || !b) return 0;

      const dp = Array.from(
        { length: a.length + 1 },
        () => Array(b.length + 1).fill(0)
      );

      for (let i = 0; i <= a.length; i++) dp[i][0] = i;
      for (let j = 0; j <= b.length; j++) dp[0][j] = j;

      for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;

          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + cost
          );
        }
      }

      return 1 - dp[a.length][b.length] /
        Math.max(a.length, b.length);
    }

    const rankedProducts = allProducts.map(product => {
      const brandNames = (product.brands || [])
        .map(brand => brand.name || "")
        .join(" ");

      const title = product.title || "";

      const searchableText = `${title} ${brandNames}`;
      const productWords = normalize(searchableText);
      const titleText = normalize(title).join(" ");

      const exact =
        titleText.includes(queryText) ||
        queryWords.every(word => productWords.includes(word));

      const wordScores = queryWords.map(queryWord => {
        return Math.max(
          0,
          ...productWords.map(productWord =>
            similarity(queryWord, productWord)
          )
        );
      });

      const fuzzyScore = wordScores.length
        ? wordScores.reduce((sum, score) => sum + score, 0) /
          wordScores.length
        : 0;

      const matchedWords = queryWords.filter(word =>
        productWords.includes(word)
      ).length;

      const matchScore = queryWords.length
        ? matchedWords / queryWords.length
        : 0;

      return {
        product,
        exact,
        fuzzyScore,
        matchScore
      };
    });

    const exact = rankedProducts
      .filter(item => item.exact)
      .map(item => item.product);

    const similar = rankedProducts
      .filter(item =>
        !item.exact &&
        (item.fuzzyScore >= 0.65 || item.matchScore >= 0.5)
      )
      .sort((a, b) => b.fuzzyScore - a.fuzzyScore)
      .map(item => item.product);

    const related = rankedProducts
      .filter(item =>
        !item.exact &&
        !(item.fuzzyScore >= 0.65 || item.matchScore >= 0.5)
      )
      .map(item => item.product);

    setExactProducts(exact);
    setSimilarProducts(similar);
    setRelatedProducts(related);

    // Keep all results available for the existing UI temporarily
    setProducts([...exact, ...similar, ...related]);

    if (allProducts.length === 0) {
      setProductError(
        "No products found. Try another search."
      );
    }

  } catch (error) {
    setProductError(
      error.message || "Unable to connect to backend."
    );
  } finally {
    setProductLoading(false);
  }
}



function formatCurrency(amount, currency = "USD") {
  const safeCurrency = (currency || "USD").toUpperCase().trim();
  const num = Number(amount || 0);

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);
  } catch {
    return `${safeCurrency} ${num.toFixed(2)}`;
  }
}

function aggregateByCurrency(items = [], filterFn = () => true) {
  const totals = {};
  for (const item of items) {
    if (!filterFn(item)) continue;
    const curr = (item.currency || "USD").toUpperCase().trim();
    const rawVal = item.amount !== undefined ? item.amount : item.total;
    totals[curr] = (totals[curr] || 0) + Number(rawVal || 0);
  }
  return totals;
}

function formatAggregatedCurrency(totals) {
  const entries = Object.entries(totals);
  if (entries.length === 0) {
    return formatCurrency(0, "USD");
  }
  return entries
    .map(([curr, amt]) => formatCurrency(amt, curr))
    .join(" · ");
}

function renderCurrencyBreakdown(totals = {}, isAlert = false, defaultCurrency = "USD") {
  const entries = Object.entries(totals || {})
    .filter(([_, amt]) => Number(amt || 0) > 0)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));

  if (entries.length === 0) {
    const safeDefault = (defaultCurrency || "USD").toUpperCase();
    return (
      <div className={`currency-metric-display single ${isAlert ? "alert" : ""}`}>
        <div className="currency-primary-line">
          <span className="currency-amt">{formatCurrency(0, safeDefault)}</span>
          <span className="currency-badge">{safeDefault}</span>
        </div>
      </div>
    );
  }

  if (entries.length === 1) {
    const [curr, amt] = entries[0];
    return (
      <div className={`currency-metric-display single ${isAlert ? "alert" : ""}`}>
        <div className="currency-primary-line">
          <span className="currency-amt">{formatCurrency(amt, curr)}</span>
          <span className="currency-badge">{curr.toUpperCase()}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`currency-metric-display multi ${isAlert ? "alert" : ""}`}>
      {entries.map(([curr, amt]) => (
        <div className="currency-subcard" key={curr}>
          <span className="currency-amt">{formatCurrency(amt, curr)}</span>
          <span className="currency-badge">{curr.toUpperCase()}</span>
        </div>
      ))}
    </div>
  );
}

function generateNextInvoiceId(invoices = []) {
  const existingIds = new Set(
    (invoices || []).map(inv => String(inv.id || "").trim()).filter(Boolean)
  );

  let maxNum = 1000;
  for (const inv of invoices || []) {
    const match = String(inv.id || "").trim().match(/^INV-(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  let nextNum = maxNum + 1;
  let candidateId = `INV-${nextNum}`;
  while (existingIds.has(candidateId)) {
    nextNum += 1;
    candidateId = `INV-${nextNum}`;
  }
  return candidateId;
}

function getBestOffer(product) {
  const offers = Array.isArray(product?.offers) ? product.offers : [];
  if (offers.length === 0) return null;

  // Prefer offer with both valid price and URL
  const withPriceAndUrl = offers.find(
    o => o?.price?.price != null && !isNaN(Number(o?.price?.price)) && o?.url
  );
  if (withPriceAndUrl) return withPriceAndUrl;

  // Next prefer offer with valid price
  const withPrice = offers.find(
    o => o?.price?.price != null && !isNaN(Number(o?.price?.price))
  );
  if (withPrice) return withPrice;

  // Next prefer offer with URL
  const withUrl = offers.find(o => Boolean(o?.url));
  if (withUrl) return withUrl;

  return offers[0] || null;
}

function formatProductPrice(offer) {
  const priceVal = offer?.price?.price;
  if (priceVal == null || isNaN(Number(priceVal))) {
    return "Price unavailable";
  }
  const formattedNum = Number(priceVal).toFixed(2);
  const currency = offer?.price?.currency?.trim();
  if (currency) {
    return `${currency} ${formattedNum}`;
  }
  return formattedNum;
}

function addProductToInvoice(product) {
  const offer = getBestOffer(product);
  const price = offer?.price?.price;
  const productCurrency = (offer?.price?.currency || "USD").toUpperCase().trim();

  if (price == null || isNaN(Number(price))) {
    setProductError("Price is not available for this product.");
    return;
  }

  const numericPrice = Number(Number(price).toFixed(2));

  const newItem = {
    description: product.title || "Product",
    quantity: 1,
    price: numericPrice
  };

  const isOnlyEmptyItem =
    items.length === 1 &&
    (!items[0].description || !items[0].description.trim()) &&
    Number(items[0].price || 0) === 0;

  if (!isOnlyEmptyItem && invoiceCurrency && invoiceCurrency !== productCurrency) {
    alert(`Cannot combine items with different currencies on the same invoice (Invoice currency: ${invoiceCurrency}, Product currency: ${productCurrency}). Currency conversion is not supported.`);
    return;
  }

  if (isOnlyEmptyItem) {
    setInvoiceCurrency(productCurrency);
    setItems([newItem]);
  } else {
    setItems(old => [...old, newItem]);
  }

  alert("Product added to invoice!");
}

function removeItem(index) {
  if (items.length <= 1) {
    return;
  }
  setItems(old => old.filter((_, i) => i !== index));
}

function openCreateInvoice(preselectedCustomer = null) {
  setEditingInvoiceId(null);
  if (preselectedCustomer) {
    setSelectedCustomerId(preselectedCustomer.id);
    setCustomer(preselectedCustomer.name || "");
    setEmail(preselectedCustomer.email || "");
  } else {
    setSelectedCustomerId(null);
    setCustomer("");
    setEmail("");
  }
  setInvoiceCurrency(appSettings.default_currency || "USD");
  setDueDate(getDefaultDueDate(Number(appSettings.default_due_days || 30)));
  setItems([{ description: "", quantity: 1, price: 0 }]);
  setInvoiceNumber(generateNextInvoiceId(savedInvoices));
  setPreviousPage(page);
  setPage("Create Invoice");
}

function editInvoice(invoice) {
  if (invoice.status === "Paid") {
    alert("Paid invoices cannot be edited.");
    return;
  }
  setEditingInvoiceId(invoice.id);
  setCustomer(invoice.customer);
  setEmail(invoice.email);
  setInvoiceCurrency(invoice.currency || "USD");
  setDueDate(invoice.due_date || "");
  setItems(
    invoice.items || [{ description: "", quantity: 1, price: invoice.total }]
  );
  setPage("Create Invoice");
}

async function createInvoice(e) {
  e.preventDefault();

  if (!customer.trim() || !email.trim() || total <= 0) {
    alert("Please enter customer details and a valid invoice amount.");
    return;
  }

  // Ensure new invoice ID is unique and avoids HTTP 409 collisions
  let finalId = editingInvoiceId;
  if (!finalId) {
    if (!invoiceNumber || savedInvoices.some(inv => inv.id === invoiceNumber)) {
      finalId = generateNextInvoiceId(savedInvoices);
    } else {
      finalId = invoiceNumber;
    }
  }

  const existingInv = savedInvoices.find(inv => inv.id === editingInvoiceId);
  if (existingInv && existingInv.status === "Paid") {
    alert("Cannot modify a paid invoice.");
    return;
  }

  const invoice = {
    id: finalId,
    customer,
    email,
    items: [...items],
    total,
    currency: invoiceCurrency || "USD",
    status: (existingInv && existingInv.status) || "Draft",
    due_date: dueDate && dueDate.trim() ? dueDate.trim() : null,
    customer_id: selectedCustomerId || null
  };

  try {
    const response = await fetch(
      editingInvoiceId
        ? `http://127.0.0.1:8000/api/invoices/${editingInvoiceId}`
        : "http://127.0.0.1:8000/api/invoices",
      {
        method: editingInvoiceId ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(invoice)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Invoice could not be saved.");
    }

    alert(
      editingInvoiceId
        ? "Invoice updated successfully!"
        : "Invoice created successfully!"
    );

    setEditingInvoiceId(null);
    setCustomer("");
    setEmail("");
    setDueDate(getDefaultDueDate(30));
    setItems([{ description: "", quantity: 1, price: 0 }]);

    const refreshed = await loadInvoices();
    await loadCustomers();
    setInvoiceNumber(generateNextInvoiceId(refreshed || []));
    setPage("Invoices");

  } catch (error) {
    alert(error.message || "Unable to connect to backend.");
  }
}

async function loadInvoices() {
  setInvoicesLoading(true);
  setInvoicesError("");
  try {
    const response = await fetch(
      "http://127.0.0.1:8000/api/invoices"
    );

    if (!response.ok) {
      throw new Error(`Unable to load invoices from server (HTTP ${response.status}).`);
    }

    const data = await response.json();
    setSavedInvoices(data);

    // If not editing, ensure invoiceNumber avoids duplicate IDs
    setInvoiceNumber(prev => {
      if (!prev || prev === "INV-1001" || data.some(inv => inv.id === prev)) {
        return generateNextInvoiceId(data);
      }
      return prev;
    });

    return data;
  } catch (error) {
    console.error("Invoice loading error:", error);
    setInvoicesError(error.message || "Failed to connect to backend server.");
    return [];
  } finally {
    setInvoicesLoading(false);
  }
}



  const filteredInvoices = useMemo(() => {
    return (savedInvoices || [])
      .filter(inv => {
        // Search filter (customer name, ID or email)
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase().trim();
          const matchesCustomer = (inv.customer || "").toLowerCase().includes(q);
          const matchesId = (inv.id || "").toLowerCase().includes(q);
          const matchesEmail = (inv.email || "").toLowerCase().includes(q);
          if (!matchesCustomer && !matchesId && !matchesEmail) {
            return false;
          }
        }
        // Status filter (respect actual DB status, no relabeling)
        if (statusFilter !== "All") {
          const invStatus = (inv.status || "").toLowerCase();
          if (invStatus !== statusFilter.toLowerCase()) {
            return false;
          }
        }
        if (overdueOnly && !isInvoiceOverdue(inv)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "due-asc") {
          if (!a.due_date && !b.due_date) return 0;
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return a.due_date.localeCompare(b.due_date);
        }
        if (sortBy === "customer-asc") {
          return (a.customer || "").localeCompare(b.customer || "");
        }
        if (sortBy === "customer-desc") {
          return (b.customer || "").localeCompare(a.customer || "");
        }
        if (sortBy === "amount-desc") {
          return Number(b.total || 0) - Number(a.total || 0);
        }
        if (sortBy === "amount-asc") {
          return Number(a.total || 0) - Number(b.total || 0);
        }
        if (sortBy === "date-asc") {
          if (a.paid_at && b.paid_at) {
            return new Date(a.paid_at) - new Date(b.paid_at);
          }
          return (a.id || "").localeCompare(b.id || "", undefined, { numeric: true });
        }
        // Default "date-desc" (Newest first)
        if (a.paid_at && b.paid_at) {
          return new Date(b.paid_at) - new Date(a.paid_at);
        }
        return (b.id || "").localeCompare(a.id || "", undefined, { numeric: true });
      });
  }, [savedInvoices, searchTerm, statusFilter, sortBy, overdueOnly]);

  const filteredCustomers = useMemo(() => {
    return (customers || []).filter(c => {
      if (!customerSearchTerm.trim()) return true;
      const q = customerSearchTerm.toLowerCase().trim();
      const matchName = (c.name || "").toLowerCase().includes(q);
      const matchEmail = (c.email || "").toLowerCase().includes(q);
      const matchCompany = (c.company || "").toLowerCase().includes(q);
      const matchPhone = (c.phone || "").toLowerCase().includes(q);
      const matchId = (c.id || "").toLowerCase().includes(q);
      return matchName || matchEmail || matchCompany || matchPhone || matchId;
    });
  }, [customers, customerSearchTerm]);

  const totalCustomersPaid = useMemo(() => {
    const totals = {};
    for (const c of customers || []) {
      for (const [curr, amt] of Object.entries(c.total_paid || {})) {
        totals[curr] = (totals[curr] || 0) + Number(amt || 0);
      }
    }
    return totals;
  }, [customers]);

  const totalCustomersOutstanding = useMemo(() => {
    const totals = {};
    for (const c of customers || []) {
      for (const [curr, amt] of Object.entries(c.outstanding || {})) {
        totals[curr] = (totals[curr] || 0) + Number(amt || 0);
      }
    }
    return totals;
  }, [customers]);

  const activeCustomer = useMemo(() => {
    if (!viewingCustomerId) return null;
    return customers.find(c => c.id === viewingCustomerId) || null;
  }, [customers, viewingCustomerId]);

  const filteredAndSortedPayments = useMemo(() => {
    return (payments || [])
      .filter(p => {
        if (paymentSearchTerm.trim()) {
          const q = paymentSearchTerm.toLowerCase().trim();
          const matchId = (p.id || "").toLowerCase().includes(q);
          const matchInv = (p.invoice_id || "").toLowerCase().includes(q);
          const matchCust = (p.customer || "").toLowerCase().includes(q);
          const matchEmail = (p.email || "").toLowerCase().includes(q);
          const matchOrder = (p.paypal_order_id || "").toLowerCase().includes(q);
          const matchCapture = (p.paypal_capture_id || "").toLowerCase().includes(q);
          if (!matchId && !matchInv && !matchCust && !matchEmail && !matchOrder && !matchCapture) {
            return false;
          }
        }
        if (paymentStatusFilter !== "All") {
          const s = (p.status || "").toLowerCase();
          if (s !== paymentStatusFilter.toLowerCase()) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        if (paymentSortBy === "amount-desc") {
          return Number(b.amount || 0) - Number(a.amount || 0);
        }
        if (paymentSortBy === "amount-asc") {
          return Number(a.amount || 0) - Number(b.amount || 0);
        }
        if (paymentSortBy === "date-asc") {
          const dA = new Date(a.paid_at || a.created_at || 0);
          const dB = new Date(b.paid_at || b.created_at || 0);
          return dA - dB;
        }
        // date-desc default
        const dA = new Date(a.paid_at || a.created_at || 0);
        const dB = new Date(b.paid_at || b.created_at || 0);
        return dB - dA;
      });
  }, [payments, paymentSearchTerm, paymentStatusFilter, paymentSortBy]);

  const navItems = ["Overview", "Invoices", "Payments", "Customers", "AI Copilot", "Reports", "Settings"];
  const navIcons = {
    "Overview": <IconOverview width={18} height={18} className="nav-icon" />,
    "Invoices": <IconInvoices width={18} height={18} className="nav-icon" />,
    "Payments": <IconPayments width={18} height={18} className="nav-icon" />,
    "Customers": <IconCustomers width={18} height={18} className="nav-icon" />,
    "AI Copilot": <IconAI width={18} height={18} className="nav-icon" />,
    "Reports": <IconReports width={18} height={18} className="nav-icon" />,
    "Settings": <IconSettings width={18} height={18} className="nav-icon" />
  };

  return (
    <div className="app">
      {/* Mobile Top Header */}
      <div className="mobile-header">
        <div className="brand" style={{ padding: 0, margin: 0, border: "none" }}>
          <div className="brand-icon">P</div>
          <h2>PayPilot<span> AI</span></h2>
        </div>
        <button
          type="button"
          className="mobile-menu-btn"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle navigation menu"
        >
          {mobileMenuOpen ? <IconClose width={22} height={22} /> : <IconMenu width={22} height={22} />}
        </button>
      </div>

      {mobileMenuOpen && (
        <div
          className="mobile-backdrop open"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside className={`sidebar ${mobileMenuOpen ? "open" : ""}`}>
        <div>
          <div className="brand">
            <div className="brand-icon">P</div>
            <h2>PayPilot<span> AI</span></h2>
          </div>

          <p className="nav-label">WORKSPACE</p>
          <nav>
            {navItems.map((item) => (
              <button
                key={item}
                className={page === item ? "nav-link active" : "nav-link"}
                onClick={() => navigateTo(item)}
              >
                {navIcons[item]}
                <span>{item}</span>
                {item === "AI Copilot" && <small>NEW</small>}
              </button>
            ))}
          </nav>
        </div>

        <div className="sidebar-bottom">
          <div className="upgrade-card">
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#60a5fa" }}>
              <IconZap width={16} height={16} />
              <strong>AI Financial Engine</strong>
            </div>
            <p>Deterministic local parser active. Instant invoice extraction.</p>
            <button type="button" onClick={() => { setPage("AI Copilot"); setMobileMenuOpen(false); }}>
              Launch Copilot &rarr;
            </button>
          </div>
          <div
            className="env-status-card"
            title={systemHealth.paypal_configured ? "PayPal Sandbox Connected" : "Sandbox Policy Enforced · Credentials Pending"}
          >
            <span className={`env-status-dot ${systemHealth.paypal_configured ? "emerald" : "amber"}`}></span>
            <div className="env-status-text">
              <span className="env-status-title">
                {systemHealth.paypal_configured ? "PayPal Sandbox Active" : "Sandbox Policy Enforced"}
              </span>
              <span className="env-status-sub">
                {systemHealth.paypal_configured ? "Credentials Verified" : "Credentials Pending"}
              </span>
            </div>
          </div>
          <div className="user-profile">
            <div className="avatar">PO</div>
            <div>
              <strong>PayPilot Merchant</strong>
              <p>Business Workspace</p>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        {paymentNotification && (
          <div className={`payment-notification-banner ${paymentNotification.type}`}>
            <span>{paymentNotification.message}</span>
            <button onClick={() => setPaymentNotification(null)} aria-label="Dismiss"><IconClose width={14} height={14} /></button>
          </div>
        )}
        {page === "Overview" && (() => {
          const paidInvoices = savedInvoices.filter(i => (i.status || "").toLowerCase() === "paid");
          const draftInvoices = savedInvoices.filter(i => (i.status || "").toLowerCase() === "draft");
          const pendingInvoices = savedInvoices.filter(i => (i.status || "").toLowerCase() === "pending");
          const overdueInvoices = savedInvoices.filter(inv => isInvoiceOverdue(inv));
          
          const paidAgg = aggregateByCurrency(savedInvoices, i => (i.status || "").toLowerCase() === "paid");
          const draftAgg = aggregateByCurrency(savedInvoices, i => (i.status || "").toLowerCase() === "draft");
          const overdueAgg = aggregateByCurrency(savedInvoices, inv => isInvoiceOverdue(inv));

          const totalCount = savedInvoices.length;
          const paidPct = totalCount > 0 ? Math.round((paidInvoices.length / totalCount) * 100) : 0;
          const pendingPct = totalCount > 0 ? Math.round((pendingInvoices.length / totalCount) * 100) : 0;
          const overduePct = totalCount > 0 ? Math.round((overdueInvoices.length / totalCount) * 100) : 0;
          const draftPct = Math.max(0, 100 - (paidPct + pendingPct + overduePct));

          return (
            <>
              <header className="topbar">
                <div>
                  <p className="breadcrumb">Workspace / Executive Overview</p>
                  <h1>Financial Command Center</h1>
                  <p className="page-subtitle">Real-time multi-currency receivables, liquidity exposure & billing operations.</p>
                </div>
                <div className="top-actions">
                  <button type="button" className="period-btn" onClick={loadInvoices} title="Reload financial ledger">
                    <IconRefresh width={14} height={14} /> Refresh
                  </button>
                  <button type="button" className="secondary-action-btn" onClick={() => setPage("AI Copilot")}>
                    <IconZap width={14} height={14} /> AI Copilot
                  </button>
                  <button type="button" className="create-btn" onClick={openCreateInvoice}>
                    <IconPlus width={15} height={15} /> New Invoice
                  </button>
                </div>
              </header>

              {/* Master Executive Financial Command Center Hero */}
              <section className="command-center-hero">
                <div className="hero-top-row">
                  <div className="hero-liquidity-panel">
                    <div className="hero-eyebrow">
                      <span className="live-status-dot emerald"></span>
                      <span>SETTLED REVENUE & NET LIQUIDITY</span>
                    </div>
                    <div className="hero-main-amount">
                      {renderCurrencyBreakdown(paidAgg)}
                    </div>
                    <div className="hero-efficiency-meter">
                      <div className="efficiency-header">
                        <span>Collection Efficiency</span>
                        <strong>{paidPct}%</strong>
                      </div>
                      <div className="efficiency-track">
                        <div className="efficiency-fill" style={{ width: `${paidPct}%` }}></div>
                      </div>
                      <p className="hero-supporting-text">
                        {paidInvoices.length} of {totalCount} invoices settled · Verified Sandbox captures & audit ledger
                      </p>
                    </div>
                  </div>

                  <div className="hero-ledger-cards">
                    <div className="hero-ledger-card settled">
                      <div className="card-tag">
                        <span className="dot emerald"></span>
                        <span>SETTLED REVENUE</span>
                      </div>
                      <div className="card-figure">
                        {renderCurrencyBreakdown(paidAgg)}
                      </div>
                      <div className="card-sub">{paidInvoices.length} paid invoice{paidInvoices.length === 1 ? '' : 's'}</div>
                    </div>

                    <div className="hero-ledger-card in-flight">
                      <div className="card-tag">
                        <span className="dot slate"></span>
                        <span>IN-FLIGHT DRAFTS</span>
                      </div>
                      <div className="card-figure">
                        {renderCurrencyBreakdown(draftAgg)}
                      </div>
                      <div className="card-sub">
                        {draftInvoices.length} draft{draftInvoices.length === 1 ? '' : 's'} {pendingInvoices.length > 0 ? `· ${pendingInvoices.length} checkout` : ''}
                      </div>
                    </div>

                    <div className={`hero-ledger-card overdue ${overdueInvoices.length > 0 ? 'has-overdue' : ''}`}>
                      <div className="card-tag">
                        <span className={`dot ${overdueInvoices.length > 0 ? 'rose' : 'muted'}`}></span>
                        <span>OVERDUE RISK EXPOSURE</span>
                      </div>
                      <div className="card-figure">
                        {renderCurrencyBreakdown(overdueAgg, overdueInvoices.length > 0)}
                      </div>
                      <div className="card-sub">
                        {overdueInvoices.length} overdue invoice{overdueInvoices.length === 1 ? '' : 's'} {overdueInvoices.length > 0 ? '· Action needed' : '· Zero exposure'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Portfolio Receivables Distribution Track */}
                <div className="hero-distribution-section">
                  <div className="distribution-header">
                    <span>PORTFOLIO RECEIVABLES DISTRIBUTION</span>
                    <span className="distribution-total-count">{totalCount} Total Invoices</span>
                  </div>
                  <div className="distribution-bar">
                    {paidPct > 0 && (
                      <div
                        className="dist-seg paid"
                        style={{ width: `${paidPct}%` }}
                        title={`Paid: ${paidPct}% (${paidInvoices.length})`}
                      />
                    )}
                    {pendingPct > 0 && (
                      <div
                        className="dist-seg pending"
                        style={{ width: `${pendingPct}%` }}
                        title={`Pending: ${pendingPct}% (${pendingInvoices.length})`}
                      />
                    )}
                    {draftPct > 0 && (
                      <div
                        className="dist-seg draft"
                        style={{ width: `${draftPct}%` }}
                        title={`Draft: ${draftPct}% (${draftInvoices.length})`}
                      />
                    )}
                    {overduePct > 0 && (
                      <div
                        className="dist-seg overdue"
                        style={{ width: `${overduePct}%` }}
                        title={`Overdue: ${overduePct}% (${overdueInvoices.length})`}
                      />
                    )}
                  </div>
                  <div className="distribution-legend">
                    <span className="legend-item"><span className="dot emerald"></span> Paid {paidPct}% ({paidInvoices.length})</span>
                    {pendingInvoices.length > 0 && (
                      <span className="legend-item"><span className="dot sky"></span> Pending {pendingPct}% ({pendingInvoices.length})</span>
                    )}
                    <span className="legend-item"><span className="dot slate"></span> Draft {draftPct}% ({draftInvoices.length})</span>
                    <span className="legend-item"><span className="dot rose"></span> Overdue {overduePct}% ({overdueInvoices.length})</span>
                  </div>
                </div>
              </section>

              {/* Lower 2-Column Command Center Grid */}
              <section className="bottom-grid command-bottom-grid">
                <div className="panel command-ledger-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Recent Transactions</h3>
                      <p>Latest real-time SQLite invoice ledger records</p>
                    </div>
                    {savedInvoices.length > 5 && (
                      <button className="period-btn" onClick={() => setPage("Invoices")}>
                        View all ({savedInvoices.length}) →
                      </button>
                    )}
                  </div>

                  {invoicesLoading ? (
                    <div className="table-loading-state">
                      <div className="spinner-small"></div>
                      <span>Loading recent transactions...</span>
                    </div>
                  ) : invoicesError ? (
                    <div className="invoices-error-banner">
                      <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><IconAlert width={15} height={15} /> {invoicesError}</span>
                      <button type="button" className="retry-btn" onClick={loadInvoices}>Retry</button>
                    </div>
                  ) : savedInvoices.length === 0 ? (
                    <div className="empty-state-mini">
                      <p>No invoice transactions recorded yet.</p>
                      <button type="button" className="create-btn" onClick={openCreateInvoice}><IconPlus width={15} height={15} /> Create Invoice</button>
                    </div>
                  ) : (
                    <div className="recent-tx-list">
                      {[...savedInvoices].slice(-5).reverse().map(invoice => {
                        const statusClass = (invoice.status || "draft").toLowerCase();
                        const isOverdue = isInvoiceOverdue(invoice);
                        const initials = (invoice.customer || "CU")
                          .split(" ")
                          .filter(Boolean)
                          .map(part => part[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase() || "CU";
                        return (
                          <div className="recent-tx-row" key={invoice.id}>
                            <div className="tx-customer-cell">
                              <div className="tx-avatar">{initials}</div>
                              <div className="recent-tx-left">
                                <strong className="tx-customer-name">{invoice.customer || "Unnamed Customer"}</strong>
                                <span className="recent-tx-id">
                                  <span className="id-tag">{invoice.id}</span>
                                  {invoice.email && ` · ${invoice.email}`}
                                  {invoice.paid_at && ` · Settled ${new Date(invoice.paid_at).toLocaleDateString()}`}
                                  {invoice.due_date && (
                                    <span className={isOverdue ? "due-tag overdue" : "due-tag"}>
                                      {isOverdue ? " · Overdue " : " · Due "}{invoice.due_date}
                                    </span>
                                  )}
                                </span>
                              </div>
                            </div>
                            <div className="recent-tx-right">
                              <span className="tx-amount">{formatCurrency(invoice.total, invoice.currency)}</span>
                              <span className={`table-status ${statusClass}`}>{invoice.status}</span>
                              <button
                                type="button"
                                className="action-pill-btn"
                                onClick={() => openEditInvoice(invoice)}
                                title="Inspect or edit invoice"
                              >
                                Edit
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="command-side-stack">
                  {/* AI Copilot Launchpad */}
                  <div className="panel ai-copilot-launch-card">
                    <div className="ai-card-glow"></div>
                    <div className="ai-card-content">
                      <div className="ai-pill-header">
                        <span className="ai-badge-chip">
                          <IconAI width={14} height={14} /> AI COPILOT
                        </span>
                        <span className="latency-chip">⚡ Instant (17ms)</span>
                      </div>
                      <h4>Automated Invoice Generation</h4>
                      <p>Draft complete, itemized customer invoices from plain English prompts in milliseconds.</p>
                      <div className="ai-quick-prompts">
                        <span className="quick-prompt-label">Try prompt:</span>
                        <button
                          type="button"
                          className="quick-chip"
                          onClick={() => {
                            setAiPrompt("Create an invoice for Rahul, email rahul@example.com. 2 keyboards at $25 each and 1 mouse at $15.");
                            setPage("AI Copilot");
                          }}
                        >
                          "Rahul 2 keyboards $25 & mouse $15"
                        </button>
                        <button
                          type="button"
                          className="quick-chip"
                          onClick={() => {
                            setAiPrompt("Create an invoice for Rahul Sharma for 2 website designs at $300 each.");
                            setPage("AI Copilot");
                          }}
                        >
                          "Website designs $300 to Rahul"
                        </button>
                      </div>
                      <button
                        type="button"
                        className="launch-ai-btn"
                        onClick={() => setPage("AI Copilot")}
                      >
                        Launch AI Copilot <IconArrowRight width={14} height={14} />
                      </button>
                    </div>
                  </div>

                  {/* Operational Shortcuts */}
                  <div className="panel quick-actions-panel">
                    <div className="panel-heading">
                      <div>
                        <h3>Workspace Actions</h3>
                        <p>Direct navigation & shortcuts</p>
                      </div>
                    </div>
                    <button className="quick-action" onClick={openCreateInvoice}>
                      <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div className="action-icon-circle blue"><IconPlus width={14} height={14} /></div>
                        <div>
                          <strong>Create New Invoice</strong>
                          <p>Draft or dispatch customer bill</p>
                        </div>
                      </span>
                      <IconArrowRight width={14} height={14} />
                    </button>
                    <button className="quick-action" onClick={() => setPage("Payments")}>
                      <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div className="action-icon-circle green"><IconPayments width={14} height={14} /></div>
                        <div>
                          <strong>Track Payments</strong>
                          <p>Inspect PayPal Sandbox captures</p>
                        </div>
                      </span>
                      <IconArrowRight width={14} height={14} />
                    </button>
                    <button className="quick-action" onClick={() => setPage("Customers")}>
                      <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div className="action-icon-circle purple"><IconCustomers width={14} height={14} /></div>
                        <div>
                          <strong>Customer Directory</strong>
                          <p>View accounts and billing history</p>
                        </div>
                      </span>
                      <IconArrowRight width={14} height={14} />
                    </button>
                    <button className="quick-action" onClick={() => setPage("Reports")}>
                      <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div className="action-icon-circle amber"><IconReports width={14} height={14} /></div>
                        <div>
                          <strong>Financial Reports</strong>
                          <p>Aging analysis & CSV exports</p>
                        </div>
                      </span>
                      <IconArrowRight width={14} height={14} />
                    </button>
                  </div>
                </div>
              </section>
            </>
          );
        })()}

        {page === "Invoices" && (
          <>
            <header className="topbar">
              <div>
                <p className="breadcrumb">Workspace / Invoices</p>
                <h1>Invoices</h1>
                <p className="page-subtitle">Create and manage your customer invoices.</p>
              </div>
              <button className="create-btn" onClick={openCreateInvoice}><IconPlus width={15} height={15} /> New Invoice</button>
            </header>

            <div className="stats invoices-stats-grid">
              <div className="stat-card">
                <p>Total Invoices</p>
                <h2>{savedInvoices.length}</h2>
                <span className="stat-subtext">All created drafts & invoices</span>
              </div>
              <div className="stat-card">
                <p>Paid Revenue</p>
                {renderCurrencyBreakdown(aggregateByCurrency(savedInvoices, i => (i.status || "").toLowerCase() === "paid"))}
                <span className="stat-subtext">
                  {savedInvoices.filter(i => (i.status || "").toLowerCase() === "paid").length} paid invoice{savedInvoices.filter(i => (i.status || "").toLowerCase() === "paid").length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="stat-card">
                <p>Draft Value</p>
                {renderCurrencyBreakdown(aggregateByCurrency(savedInvoices, i => (i.status || "").toLowerCase() === "draft"))}
                <span className="stat-subtext">
                  {savedInvoices.filter(i => (i.status || "").toLowerCase() === "draft").length} draft invoice{savedInvoices.filter(i => (i.status || "").toLowerCase() === "draft").length === 1 ? '' : 's'}
                </span>
              </div>
              {savedInvoices.some(i => (i.status || "").toLowerCase() === "pending") && (
                <div className="stat-card">
                  <p>Pending Checkout</p>
                  {renderCurrencyBreakdown(aggregateByCurrency(savedInvoices, i => (i.status || "").toLowerCase() === "pending"))}
                  <span className="stat-subtext">
                    {savedInvoices.filter(i => (i.status || "").toLowerCase() === "pending").length} awaiting capture
                  </span>
                </div>
              )}
              <div className="stat-card">
                <p>Overdue Invoices</p>
                {renderCurrencyBreakdown(
                  aggregateByCurrency(savedInvoices, inv => isInvoiceOverdue(inv)),
                  savedInvoices.some(inv => isInvoiceOverdue(inv))
                )}
                <span className="stat-subtext" style={{ color: savedInvoices.some(inv => isInvoiceOverdue(inv)) ? "#b91c1c" : "inherit", fontWeight: savedInvoices.some(inv => isInvoiceOverdue(inv)) ? 600 : "normal" }}>
                  {savedInvoices.filter(inv => isInvoiceOverdue(inv)).length} overdue invoice{savedInvoices.filter(inv => isInvoiceOverdue(inv)).length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="stat-card">
                <p>Total Portfolio Value</p>
                {renderCurrencyBreakdown(aggregateByCurrency(savedInvoices))}
                <span className="stat-subtext">Combined across all currencies</span>
              </div>
            </div>

            <div className="panel">
              <div className="panel-heading">
                <div>
                  <h3>All invoices</h3>
                  <p>Manage, search and filter your invoices</p>
                </div>
              </div>

              {/* Search, Filter and Sort Toolbar */}
              <div className="invoice-toolbar">
                <div className="search-box">
                  <IconSearch width={14} height={14} className="search-icon" />
                  <input
                    type="text"
                    placeholder="Search by customer name, email or invoice ID..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    aria-label="Search invoices"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      className="clear-search-btn"
                      onClick={() => setSearchTerm("")}
                      aria-label="Clear search"
                    ><IconClose width={14} height={14} /></button>
                  )}
                </div>

                <div className="filter-sort-controls">
                  <div className="status-filter-group" role="group" aria-label="Filter invoices by status">
                    {["All", "Draft", "Pending", "Paid"].map(status => {
                      const count = status === "All"
                        ? savedInvoices.length
                        : savedInvoices.filter(i => (i.status || "").toLowerCase() === status.toLowerCase()).length;
                      return (
                        <button
                          key={status}
                          type="button"
                          className={`filter-chip ${!overdueOnly && statusFilter.toLowerCase() === status.toLowerCase() ? "active" : ""}`}
                          onClick={() => {
                            setStatusFilter(status);
                            setOverdueOnly(false);
                          }}
                        >
                          {status}
                          <span className="filter-count">{count}</span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className={`filter-chip ${overdueOnly ? "active" : ""}`}
                      onClick={() => {
                        setOverdueOnly(true);
                        setStatusFilter("All");
                      }}
                    >
                      Overdue
                      <span className="filter-count">{savedInvoices.filter(inv => isInvoiceOverdue(inv)).length}</span>
                    </button>
                  </div>

                  <div className="sort-selector">
                    <label htmlFor="sort-invoices">Sort:</label>
                    <select
                      id="sort-invoices"
                      value={sortBy}
                      onChange={e => setSortBy(e.target.value)}
                    >
                      <option value="date-desc">Newest first</option>
                      <option value="date-asc">Oldest first</option>
                      <option value="due-asc">Due date (Soonest first)</option>
                      <option value="customer-asc">Customer (A–Z)</option>
                      <option value="customer-desc">Customer (Z–A)</option>
                      <option value="amount-desc">Amount (High to Low)</option>
                      <option value="amount-asc">Amount (Low to High)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Invoices List Body with Loading, Error and Empty States */}
              {invoicesLoading ? (
                <div className="table-loading-state">
                  <div className="spinner-small"></div>
                  <span>Loading invoices from SQLite database...</span>
                </div>
              ) : invoicesError ? (
                <div className="invoices-error-banner">
                  <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><IconAlert width={15} height={15} /> {invoicesError}</span>
                  <button type="button" className="retry-btn" onClick={loadInvoices}>Retry</button>
                </div>
              ) : savedInvoices.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon"><IconInvoices width={36} height={36} /></div>
                  <h3>No invoices yet</h3>
                  <p>Create your first invoice to get started.</p>
                  <button type="button" className="create-btn" onClick={openCreateInvoice}><IconPlus width={15} height={15} /> Create your first invoice</button>
                </div>
              ) : filteredInvoices.length === 0 ? (
                <div className="empty-state-filtered">
                  <div className="empty-icon"><IconSearch width={36} height={36} /></div>
                  <h3>No matching invoices found</h3>
                  <p>
                    {overdueOnly
                      ? `No overdue invoices matched${searchTerm ? ` search "${searchTerm}"` : ""}.`
                      : searchTerm
                      ? `No invoices matched search "${searchTerm}" with status "${statusFilter}".`
                      : `No invoices currently have status "${statusFilter}".`}
                  </p>
                  <button
                    type="button"
                    className="period-btn"
                    onClick={() => {
                      setSearchTerm("");
                      setStatusFilter("All");
                      setOverdueOnly(false);
                    }}
                  >
                    Clear Search & Filters
                  </button>
                </div>
              ) : (
                filteredInvoices.map(invoice => {
                  const statusClass = (invoice.status || "draft").toLowerCase();
                  return (
                    <div className="invoice-list-row" key={invoice.id}>
                      <div>
                        <strong>{invoice.id}</strong>
                        <p>{invoice.customer} · {invoice.email}</p>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "3px", flexWrap: "wrap" }}>
                          {invoice.paid_at && (
                            <span style={{ fontSize: "11px", color: "#059669" }}>
                              Paid: {new Date(invoice.paid_at).toLocaleDateString()}
                              {invoice.paypal_capture_id && ` · Ref: ${invoice.paypal_capture_id}`}
                            </span>
                          )}
                          {invoice.due_date && (
                            <span style={{ fontSize: "11px", color: isInvoiceOverdue(invoice) ? "#b91c1c" : "#64748b", fontWeight: isInvoiceOverdue(invoice) ? 700 : 400 }}>
                              {isInvoiceOverdue(invoice) ? "Overdue: " : "Due: "}{invoice.due_date}
                            </span>
                          )}
                        </div>
                      </div>

                      <strong>{formatCurrency(invoice.total, invoice.currency)}</strong>

                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <span className={`table-status ${statusClass}`}>
                          {invoice.status}
                        </span>
                        {isInvoiceOverdue(invoice) && (
                          <span className="table-status overdue" title={`Due date passed on ${invoice.due_date}`}>
                            Overdue
                          </span>
                        )}
                      </div>

                      {invoice.status !== "Paid" ? (
                        <button
                          onClick={() => initiatePayPalCheckout(invoice)}
                          className="paypal-button"
                          disabled={paymentLoading}
                          title="Pay this invoice via PayPal Sandbox"
                        >
                          {paymentLoading ? "Connecting..." : "Pay with PayPal"}
                        </button>
                      ) : (
                        <span className="paid-tag" title={invoice.paypal_capture_id ? `Capture Ref: ${invoice.paypal_capture_id}` : "Paid"}>
                          <IconCheck width={12} height={12} style={{ display: "inline-block", verticalAlign: "middle", marginRight: "4px" }} /> Paid
                        </span>
                      )}

                      <button
                        onClick={() => editInvoice(invoice)}
                        className="edit-button"
                        disabled={invoice.status === "Paid"}
                        title={invoice.status === "Paid" ? "Paid invoices cannot be edited" : "Edit invoice"}
                      >
                        Edit
                      </button>

                      <button
                        onClick={() => deleteInvoice(invoice.id)}
                        className="delete-button"
                      >
                        Delete
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {page === "Create Invoice" && (
          <>
            <header className="topbar">
              <div>
                <p className="breadcrumb">Workspace / Invoices / New</p>
                <h1>Create new invoice</h1>
                <p className="page-subtitle">Add customer and service details.</p>
              </div>
              <button className="period-btn" onClick={handleBack}>← Back to {previousPage === "Customers" ? "Customer" : (previousPage || "Invoices")}</button>
            </header>

{renderAIGenerator()}
<div className="panel invoice-form">
  <div className="form-heading">
    <div>
      <h3>🛍️ Channel3 Product Search</h3>
      <p>Search real products and add them to your invoice.</p>
    </div>
    <span className="draft-label">CHANNEL3</span>
  </div>

  <div className="form-grid">
    <input
      value={productQuery}
      onChange={e => setProductQuery(e.target.value)}
      placeholder="Search products, e.g. wireless headphones"
    />

    <button
      type="button"
      className="create-btn"
      onClick={searchProducts}
      disabled={productLoading}
    >
      {productLoading ? "Searching..." : "Search Products"}
    </button>
  </div>

  {productError && <p>{productError}</p>}

 

{products.map(product => {
  const offer = getBestOffer(product);

  const imageUrl =
    product.images?.find(img => img.is_main_image)?.url ||
    product.images?.[0]?.url;

  const priceText = formatProductPrice(offer);
  const retailer = offer?.domain;
  const availability = offer?.availability;
  const hasValidPrice = offer?.price?.price != null && !isNaN(Number(offer?.price?.price));

  return (
    <div className="invoice-list-row" key={product.id}>
      <div style={{
        display: "flex",
        gap: "18px",
        alignItems: "center",
        flexWrap: "wrap",
        width: "100%"
      }}>
        {imageUrl && (
          <img
            src={imageUrl}
            alt={product.images?.[0]?.alt_text || product.title}
            style={{
              width: "130px",
              height: "130px",
              objectFit: "contain",
              borderRadius: "10px"
            }}
          />
        )}

        <div style={{ flex: "1", minWidth: "200px" }}>
          <h3>{product.title}</h3>

          {product.brands?.[0]?.name && (
            <p>Brand: {product.brands[0].name}</p>
          )}

          <h3>{priceText}</h3>

          {retailer && <p>Retailer: {retailer}</p>}

          {availability && <p>Availability: {availability}</p>}

          {product.ratings && (
            <p>
              Rating: {product.ratings.value}/5
              {" "}({product.ratings.count} reviews)
            </p>
          )}

          {offer?.url && (
            <p>
              <a
                href={offer.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                View Product Details ↗
              </a>
            </p>
          )}

          <button
            type="button"
            className="edit-button"
            onClick={() => addProductToInvoice(product)}
            disabled={!hasValidPrice}
          >
            Add to Invoice
          </button>
        </div>
      </div>
    </div>
  );
})}


</div>
            <form id="invoice-details-form" className="panel invoice-form" onSubmit={createInvoice}>
              <div className="form-heading">
                <div><h3>Invoice details</h3><p>Invoice number: {invoiceNumber}</p></div>
                <span className="draft-label">NEW DRAFT</span>
              </div>

              <div className="customer-selector-container">
                <div className="customer-selector-row">
                  <label htmlFor="select-existing-customer" className="customer-select-label">
                    <span>👤 Select Existing Customer</span>
                    <select
                      id="select-existing-customer"
                      className="customer-dropdown-select"
                      value={selectedCustomerId || ""}
                      onChange={e => {
                        const cId = e.target.value;
                        setSelectedCustomerId(cId || null);
                        if (cId) {
                          const found = customers.find(c => c.id === cId);
                          if (found) {
                            setCustomer(found.name);
                            setEmail(found.email);
                          }
                        }
                      }}
                    >
                      <option value="">-- Choose an existing customer or type new details below --</option>
                      {customers.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.email}){c.company ? ` · ${c.company}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="period-btn add-cust-btn"
                    onClick={() => openCustomerModal(null)}
                    title="Register a new customer profile"
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><IconPlus width={14} height={14} /> New Customer</span>
                  </button>
                </div>
              </div>

              <div className="form-grid">
                <label>Customer name
                  <input value={customer} onChange={e => setCustomer(e.target.value)} placeholder="e.g. Rahul Sharma" required />
                </label>
                <label>Customer email
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="customer@example.com" required />
                </label>
                <label>Currency
                  <select
                    value={invoiceCurrency || "USD"}
                    onChange={e => setInvoiceCurrency(e.target.value)}
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="INR">INR (₹)</option>
                    <option value="CAD">CAD ($)</option>
                    <option value="AUD">AUD ($)</option>
                  </select>
                </label>
                <label>Payment due date
                  <input
                    type="date"
                    value={dueDate || ""}
                    onChange={e => setDueDate(e.target.value)}
                    title="Payment due date (defaults to 30 days from creation; clear if no due date)"
                  />
                  <small style={{ fontSize: "11px", color: "#64748b", marginTop: "3px" }}>
                    {dueDate ? `Due on ${dueDate}` : "No due date set (optional)"}
                  </small>
                </label>
              </div>

              <div className="form-heading items-heading">
                <div><h3>Items and services</h3><p>Add the services you are billing for.</p></div>
              </div>

              {items.map((item, index) => (
                <div className="item-input-row" key={index}>
                  <label className="description-field">Description
                    <input value={item.description} onChange={e => updateItem(index, "description", e.target.value)} placeholder="Website design" required />
                  </label>
                  <label>Qty
                    <input type="number" min="1" value={item.quantity} onChange={e => updateItem(index, "quantity", e.target.value)} required />
                  </label>
                  <label>Price ({invoiceCurrency || "USD"})
                    <input type="number" min="0" step="0.01" value={item.price} onChange={e => updateItem(index, "price", e.target.value)} required />
                  </label>
                  <div className="line-total"><span>Amount</span><strong>{formatCurrency(Number(item.quantity || 0) * Number(item.price || 0), invoiceCurrency)}</strong></div>
                  <button
                    type="button"
                    className="remove-item-btn"
                    onClick={() => removeItem(index)}
                    disabled={items.length <= 1}
                    title={items.length <= 1 ? "At least one line item is required" : "Remove item"}
                    aria-label="Remove item"
                  ><IconClose width={14} height={14} /></button>
                </div>
              ))}

              <button type="button" className="add-item-btn" onClick={addItem}><span style={{ display: "flex", alignItems: "center", gap: "6px" }}><IconPlus width={14} height={14} /> Add line item</span></button>

              <div className="invoice-total">
                <span>Total amount ({invoiceCurrency || "USD"})</span>
                <strong>{formatCurrency(total, invoiceCurrency)}</strong>
              </div>

              <div className="form-actions">
                <button type="button" className="period-btn" onClick={() => setPage("Invoices")}>Cancel</button>
                <button type="submit" className="create-btn">Create invoice →</button>
              </div>
            </form>
          </>
        )}

        {page === "Payments" && (
          <>
            <header className="topbar payments-topbar">
              <div className="topbar-left">
                <p className="breadcrumb">Workspace / Payments</p>
                <h1>Payments History</h1>
                <p className="page-subtitle">Track, audit, and inspect all PayPal Sandbox transactions and settlements.</p>
              </div>
              <div className="top-actions">
                <button type="button" className="period-btn" onClick={loadPayments} title="Refresh payments ledger">
                  <IconRefresh width={14} height={14} /> Refresh
                </button>
                <button type="button" className="create-btn" onClick={() => setPage("Invoices")}>
                  View Invoices
                </button>
              </div>
            </header>

            {/* Payments Dashboard Stats */}
            <div className="stats payments-stats-grid">
              <div className="stat-card">
                <div className="stat-top"><span>Completed Payments</span></div>
                {renderCurrencyBreakdown(aggregateByCurrency(payments, p => (p.status || "").toLowerCase() === "completed"))}
                <span className="stat-subtext">
                  {payments.filter(p => (p.status || "").toLowerCase() === "completed").length} verified capture{payments.filter(p => (p.status || "").toLowerCase() === "completed").length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="stat-card">
                <div className="stat-top"><span>Pending Checkout</span></div>
                {renderCurrencyBreakdown(aggregateByCurrency(payments, p => (p.status || "").toLowerCase() === "pending"))}
                <span className="stat-subtext">
                  {payments.filter(p => (p.status || "").toLowerCase() === "pending").length} awaiting capture
                </span>
              </div>
              <div className="stat-card">
                <div className="stat-top"><span>Failed / Cancelled</span></div>
                {renderCurrencyBreakdown(
                  aggregateByCurrency(payments, p => (p.status || "").toLowerCase() === "failed"),
                  payments.some(p => (p.status || "").toLowerCase() === "failed")
                )}
                <span className="stat-subtext" style={{ color: payments.some(p => (p.status || "").toLowerCase() === "failed") ? "#b91c1c" : "inherit" }}>
                  {payments.filter(p => (p.status || "").toLowerCase() === "failed").length} failed/cancelled attempt{payments.filter(p => (p.status || "").toLowerCase() === "failed").length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="stat-card">
                <div className="stat-top"><span>Total Payment Volume</span></div>
                {renderCurrencyBreakdown(
                  aggregateByCurrency(payments, p => (p.status || "").toLowerCase() === "completed")
                )}
                <span className="stat-subtext">
                  {payments.filter(p => (p.status || "").toLowerCase() === "completed").length} settled of {payments.length} total transaction{payments.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            {/* Payments Ledger Panel */}
            <div className="panel">
              <div className="panel-heading">
                <div>
                  <h3>Transaction ledger</h3>
                  <p>Immutable audit trail of PayPal payment attempts and verified settlements</p>
                </div>
              </div>

              {/* Toolbar matching standard app style */}
              <div className="invoice-toolbar payments-toolbar">
                <div className="search-box">
                  <IconSearch width={14} height={14} className="search-icon" />
                  <input
                    type="text"
                    placeholder="Search by Payment ID, Invoice ID, customer, order/capture ID..."
                    value={paymentSearchTerm}
                    onChange={e => setPaymentSearchTerm(e.target.value)}
                    aria-label="Search payments"
                  />
                  {paymentSearchTerm && (
                    <button
                      type="button"
                      className="clear-search-btn"
                      onClick={() => setPaymentSearchTerm("")}
                      aria-label="Clear search"
                    ><IconClose width={14} height={14} /></button>
                  )}
                </div>

                <div className="filter-sort-controls">
                  <div className="status-filter-group" role="group" aria-label="Filter payments by status">
                    {["All", "Completed", "Pending", "Failed"].map(status => {
                      const count = status === "All"
                        ? payments.length
                        : payments.filter(p => (p.status || "").toLowerCase() === status.toLowerCase()).length;
                      return (
                        <button
                          key={status}
                          type="button"
                          className={`filter-chip ${paymentStatusFilter.toLowerCase() === status.toLowerCase() ? "active" : ""}`}
                          onClick={() => setPaymentStatusFilter(status)}
                        >
                          {status}
                          <span className="filter-count">{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="sort-selector">
                    <label htmlFor="sort-payments">Sort:</label>
                    <select
                      id="sort-payments"
                      value={paymentSortBy}
                      onChange={e => setPaymentSortBy(e.target.value)}
                    >
                      <option value="date-desc">Newest first</option>
                      <option value="date-asc">Oldest first</option>
                      <option value="amount-desc">Amount: High to Low</option>
                      <option value="amount-asc">Amount: Low to High</option>
                    </select>
                  </div>
                </div>
              </div>

              {paymentsLoading ? (
                <div className="table-loading-state">
                  <div className="spinner-small"></div>
                  <span>Loading payment records from SQLite...</span>
                </div>
              ) : paymentsError ? (
                <div className="invoices-error-banner">
                  <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><IconAlert width={15} height={15} /> {paymentsError}</span>
                  <button type="button" className="retry-btn" onClick={loadPayments}>Retry</button>
                </div>
              ) : payments.length === 0 ? (
                <div className="empty-state">
                  <h3>No payment records found</h3>
                  <p>Payments initiated or completed via PayPal Sandbox will appear here automatically.</p>
                  <button type="button" className="create-btn" onClick={() => setPage("Invoices")}>
                    Go to Invoices →
                  </button>
                </div>
              ) : filteredAndSortedPayments.length === 0 ? (
                <div className="empty-state">
                  <h3>No matching payments</h3>
                  <p>No payment records match your search or filter criteria.</p>
                  <button type="button" className="period-btn" onClick={() => { setPaymentSearchTerm(""); setPaymentStatusFilter("All"); }}>
                    Reset filters
                  </button>
                </div>
              ) : (
                <div className="payments-table-wrapper">
                  <div className="payments-table-header">
                    <div className="col-id">Payment ID</div>
                    <div className="col-invoice">Invoice & Customer</div>
                    <div className="col-amount">Amount</div>
                    <div className="col-status">Status</div>
                    <div className="col-date">Date</div>
                    <div className="col-gateway">Gateway Reference</div>
                  </div>

                  {filteredAndSortedPayments.map(p => {
                    const statusLower = (p.status || "pending").toLowerCase();
                    return (
                      <div className="payments-table-row" key={p.id}>
                        <div className="col-id">
                          <span className="payment-id-pill" title={p.id}>{p.id}</span>
                          <span className="payment-provider-badge">{p.provider || "PayPal Sandbox"}</span>
                        </div>

                        <div className="col-invoice">
                          <button
                            type="button"
                            className="invoice-link-btn"
                            onClick={() => { setSearchTerm(p.invoice_id); setPage("Invoices"); }}
                            title={`Filter and view invoice ${p.invoice_id}`}
                          >
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}><IconInvoices width={13} height={13} /> {p.invoice_id}</span>
                          </button>
                          <strong className="customer-name">{p.customer || "Unnamed Customer"}</strong>
                          <span className="customer-email">{p.email}</span>
                        </div>

                        <div className="col-amount">
                          <strong>{formatCurrency(p.amount, p.currency)}</strong>
                          <span className="currency-badge">{p.currency || "USD"}</span>
                        </div>

                        <div className="col-status">
                          <span className={`table-status ${statusLower}`}>
                            {p.status}
                          </span>
                          {p.failure_reason && (
                            <div className="payment-failure-box" title={p.failure_reason}>
                              <IconAlert width={14} height={14} className="failure-icon" />
                              <span className="failure-text">{p.failure_reason}</span>
                            </div>
                          )}
                        </div>

                        <div className="col-date">
                          <span className="date-primary">{new Date(p.paid_at || p.created_at).toLocaleDateString()}</span>
                          <span className="date-secondary">{new Date(p.paid_at || p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>

                        <div className="col-gateway">
                          {p.paypal_capture_id ? (
                            <div className="gateway-badge capture" title={`PayPal Capture ID: ${p.paypal_capture_id}`}>
                              <span className="badge-tag">Capture</span>
                              <code>{p.paypal_capture_id}</code>
                            </div>
                          ) : null}
                          {p.paypal_order_id ? (
                            <div className="gateway-badge order" title={`PayPal Order ID: ${p.paypal_order_id}`}>
                              <span className="badge-tag">Order</span>
                              <code>{p.paypal_order_id}</code>
                            </div>
                          ) : null}
                          {!p.paypal_capture_id && !p.paypal_order_id && (
                            <span className="gateway-none">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {page === "AI Copilot" && (
          <>
            <header className="topbar">
              <div>
                <p className="breadcrumb">Workspace / AI Copilot</p>
                <h1>AI Invoice Copilot</h1>
                <p className="page-subtitle">Ask questions about the ledger, then draft invoices from plain English.</p>
              </div>
              <button className="create-btn" onClick={() => setPage("Invoices")}>Back to Invoices</button>
            </header>

            <section className="panel copilot-ask-panel">
              <div className="panel-heading">
                <div>
                  <h3>Ask the ledger</h3>
                  <p>Answers come from saved invoices, payments, and customers. This does not create or capture payments.</p>
                </div>
              </div>

              <label className="copilot-label" htmlFor="copilot-query">Question</label>
              <textarea
                id="copilot-query"
                className="copilot-query"
                rows={3}
                value={copilotQuery}
                placeholder="Ask about revenue, overdue invoices, a customer, or an invoice ID..."
                onChange={e => setCopilotQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    askCopilot();
                  }
                }}
              />

              <div className="copilot-chip-row">
                {copilotSuggestions.map(prompt => (
                  <button
                    key={prompt}
                    type="button"
                    className="quick-chip copilot-suggest-chip"
                    onClick={() => askCopilot(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <div className="copilot-ask-actions">
                <button
                  type="button"
                  className="create-btn"
                  onClick={() => askCopilot()}
                  disabled={copilotLoading}
                >
                  {copilotLoading ? "Asking..." : "Ask"}
                </button>
              </div>

              {copilotError && (
                <div className="invoices-error-banner copilot-error">
                  <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <IconAlert width={15} height={15} /> {copilotError}
                  </span>
                </div>
              )}

              {copilotLoading && (
                <div className="table-loading-state">
                  <div className="spinner-small"></div>
                  <span>Reading the ledger...</span>
                </div>
              )}

              {copilotResult && !copilotLoading && (
                <div className="copilot-answer">
                  <h4>{copilotResult.title}</h4>
                  <p className="copilot-narrative">{copilotResult.narrative}</p>

                  {Array.isArray(copilotResult.metrics) && copilotResult.metrics.length > 0 && (
                    <div className="copilot-metrics">
                      {copilotResult.metrics.map(metric => (
                        <div className={`copilot-metric ${metric.type || "neutral"}`} key={metric.label}>
                          <span>{metric.label}</span>
                          <strong>{metric.value}</strong>
                          {metric.badge && <em>{metric.badge}</em>}
                        </div>
                      ))}
                    </div>
                  )}

                  {copilotResult.table && Array.isArray(copilotResult.table.columns) && (
                    <div className="copilot-table-wrap">
                      <table className="copilot-table">
                        <thead>
                          <tr>
                            {copilotResult.table.columns.map(column => (
                              <th key={column}>{column}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(copilotResult.table.rows || []).length === 0 ? (
                            <tr>
                              <td colSpan={copilotResult.table.columns.length}>No matching rows.</td>
                            </tr>
                          ) : (
                            copilotResult.table.rows.map((row, rowIndex) => (
                              <tr key={`${copilotResult.intent || "row"}-${rowIndex}`}>
                                {row.map((cell, cellIndex) => (
                                  <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
                                ))}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {Array.isArray(copilotResult.suggestions) && copilotResult.suggestions.length > 0 && (
                    <div className="copilot-suggestions">
                      {copilotResult.suggestions.map(suggestion => (
                        <button
                          key={suggestion.id || suggestion.title}
                          type="button"
                          className="copilot-suggestion"
                          onClick={() => applyCopilotSuggestion(suggestion)}
                        >
                          <strong>{suggestion.title}</strong>
                          {suggestion.description && <span>{suggestion.description}</span>}
                          {suggestion.button_label && <em>{suggestion.button_label}</em>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            {renderAIGenerator()}
          </>
        )}

                {page === "Customers" && (
          <>
            {!activeCustomer ? (
              /* Customers Directory View */
              <>
                <header className="topbar customers-topbar">
                  <div className="topbar-left">
                    <p className="breadcrumb">Workspace / Customers</p>
                    <h1>Customers Directory</h1>
                    <p className="page-subtitle">Manage client profiles, inspect invoice histories, and track multi-currency balances.</p>
                  </div>
                  <div className="top-actions">
                    <button type="button" className="period-btn" onClick={loadCustomers} title="Refresh customers list">
                      <IconRefresh width={14} height={14} /> Refresh
                    </button>
                    <button type="button" className="create-btn" onClick={() => openCustomerModal(null)}>
                      <IconPlus width={15} height={15} /> Add Customer
                    </button>
                  </div>
                </header>

                {/* Customers Dashboard Metrics */}
                <div className="stats customers-stats-grid">
                  <div className="stat-card">
                    <div className="stat-top"><span>Total Customers</span></div>
                    <h2>{customers.length}</h2>
                    <span className="stat-subtext">Registered clients & accounts</span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-top"><span>Active with Invoices</span></div>
                    <h2>{customers.filter(c => c.total_invoices > 0).length}</h2>
                    <span className="stat-subtext">Clients with invoice history</span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-top"><span>Total Paid Revenue</span></div>
                    {renderCurrencyBreakdown(totalCustomersPaid)}
                    <span className="stat-subtext">Settled across all currencies</span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-top"><span>Outstanding Balances</span></div>
                    {renderCurrencyBreakdown(totalCustomersOutstanding, Object.keys(totalCustomersOutstanding).length > 0)}
                    <span className="stat-subtext">Unpaid drafts & pending</span>
                  </div>
                </div>

                {/* Customers Directory Panel */}
                <div className="panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Client contacts</h3>
                      <p>Search, filter, and inspect customer financial records</p>
                    </div>
                  </div>

                  <div className="invoice-toolbar customers-toolbar">
                    <div className="search-box">
                      <IconSearch width={14} height={14} className="search-icon" />
                      <input
                        type="text"
                        placeholder="Search by customer name, email, company, phone, ID..."
                        value={customerSearchTerm}
                        onChange={e => setCustomerSearchTerm(e.target.value)}
                        aria-label="Search customers"
                      />
                      {customerSearchTerm && (
                        <button
                          type="button"
                          className="clear-search-btn"
                          onClick={() => setCustomerSearchTerm("")}
                          aria-label="Clear search"
                        ><IconClose width={14} height={14} /></button>
                      )}
                    </div>
                  </div>

                  {customersLoading ? (
                    <div className="table-loading-state">
                      <div className="spinner-small"></div>
                      <span>Loading customers from SQLite...</span>
                    </div>
                  ) : customersError ? (
                    <div className="invoices-error-banner">
                      <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><IconAlert width={15} height={15} /> {customersError}</span>
                      <button type="button" className="retry-btn" onClick={loadCustomers}>Retry</button>
                    </div>
                  ) : customers.length === 0 ? (
                    <div className="empty-state">
                      <h3>No customers found</h3>
                      <p>Customers will be automatically identified from invoices or you can create one now.</p>
                      <button type="button" className="create-btn" onClick={() => openCustomerModal(null)}>
                        <IconPlus width={15} height={15} /> Add First Customer
                      </button>
                    </div>
                  ) : filteredCustomers.length === 0 ? (
                    <div className="empty-state">
                      <h3>No matching customers</h3>
                      <p>No customer records match your search criteria.</p>
                      <button type="button" className="period-btn" onClick={() => setCustomerSearchTerm("")}>
                        Clear search
                      </button>
                    </div>
                  ) : (
                    <div className="customers-grid">
                      {filteredCustomers.map(cust => {
                        const initials = (cust.name || "C")
                          .split(" ")
                          .map(part => part[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase();

                        const paidList = Object.entries(cust.total_paid || {}).filter(([_, a]) => Number(a) > 0);
                        const outstandingList = Object.entries(cust.outstanding || {}).filter(([_, a]) => Number(a) > 0);
                        const hasOutstanding = outstandingList.length > 0;

                        return (
                          <div className="customer-card" key={cust.id}>
                            <div className="customer-card-header">
                              <div className="customer-avatar-badge">{initials}</div>
                              <div className="customer-header-details">
                                <h4 className="customer-name-heading" title={cust.name}>{cust.name}</h4>
                                <div className="customer-meta-subrow">
                                  {cust.company && <span className="customer-company-tag">{cust.company}</span>}
                                  <span className="customer-id-pill" title={cust.id}>{cust.id}</span>
                                </div>
                              </div>
                            </div>

                            <div className="customer-contact-section">
                              <div className="customer-contact-item">
                                <span className="contact-icon-box">✉</span>
                                <a href={`mailto:${cust.email}`} className="contact-email-link" title={cust.email}>
                                  {cust.email}
                                </a>
                              </div>
                              {cust.phone ? (
                                <div className="customer-contact-item">
                                  <span className="contact-icon-box">☎</span>
                                  <span className="contact-phone-text">{cust.phone}</span>
                                </div>
                              ) : (
                                <div className="customer-contact-item muted">
                                  <span className="contact-icon-box">☎</span>
                                  <span className="contact-phone-text muted">No phone recorded</span>
                                </div>
                              )}
                            </div>

                            {/* Deliberate 3-column financial metrics grid with strict label-above-value layout */}
                            <div className="customer-metrics-grid">
                              <div className="customer-metric-tile">
                                <span className="metric-tile-label">Invoices</span>
                                <div className="metric-tile-val">
                                  <span className="metric-count-pill">{cust.total_invoices || 0}</span>
                                </div>
                              </div>
                              <div className="customer-metric-tile">
                                <span className="metric-tile-label">Total Paid</span>
                                <div className="metric-tile-val paid">
                                  {paidList.length === 0 ? (
                                    <span className="metric-amount-text zero">{formatCurrency(0, "USD")}</span>
                                  ) : (
                                    paidList.map(([curr, amt]) => (
                                      <span key={curr} className="metric-amount-text paid">
                                        {formatCurrency(amt, curr)}
                                      </span>
                                    ))
                                  )}
                                </div>
                              </div>
                              <div className="customer-metric-tile">
                                <span className="metric-tile-label">Outstanding</span>
                                <div className={`metric-tile-val ${hasOutstanding ? "outstanding" : "zero"}`}>
                                  {outstandingList.length === 0 ? (
                                    <span className="metric-amount-text zero">{formatCurrency(0, "USD")}</span>
                                  ) : (
                                    outstandingList.map(([curr, amt]) => (
                                      <span key={curr} className="metric-amount-text outstanding">
                                        {formatCurrency(amt, curr)}
                                      </span>
                                    ))
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="customer-card-actions">
                              <button
                                type="button"
                                className="period-btn customer-view-btn"
                                onClick={() => setViewingCustomerId(cust.id)}
                              >
                                View Profile →
                              </button>
                              <button
                                type="button"
                                className="edit-button customer-edit-btn"
                                onClick={() => openCustomerModal(cust)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="delete-button customer-delete-btn"
                                onClick={() => handleDeleteCustomer(cust)}
                                disabled={cust.total_invoices > 0}
                                title={cust.total_invoices > 0 ? "Cannot delete customer with associated invoices" : "Delete customer"}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* Single Customer Profile View */
              <div className="customer-profile-view">
                <header className="topbar customers-topbar">
                  <div className="topbar-left">
                    <p className="breadcrumb">
                      <span className="breadcrumb-link" onClick={() => setViewingCustomerId(null)}>Workspace / Customers</span>
                      {" / "}{activeCustomer.name}
                    </p>
                    <h1>{activeCustomer.name}</h1>
                    <p className="page-subtitle">{activeCustomer.company ? `${activeCustomer.company} · ` : ""}Client ID: {activeCustomer.id}</p>
                  </div>
                  <div className="top-actions">
                    <button type="button" className="period-btn" onClick={() => setViewingCustomerId(null)}>
                      Back to Directory
                    </button>
                    <button type="button" className="edit-button" onClick={() => openCustomerModal(activeCustomer)}>
                      ✏️ Edit Profile
                    </button>
                    <button
                      type="button"
                      className="create-btn"
                      onClick={() => openCreateInvoice(activeCustomer)}
                    >
                      <IconPlus width={15} height={15} /> New Invoice for Customer
                    </button>
                  </div>
                </header>

                {/* Profile Overview Stats */}
                <div className="stats customers-stats-grid">
                  <div className="stat-card">
                    <div className="stat-top"><span>Total Invoices</span></div>
                    <h2>{activeCustomer.total_invoices || 0}</h2>
                    <span className="stat-subtext">
                      {activeCustomer.paid_invoices || 0} paid · {activeCustomer.pending_invoices || 0} pending
                    </span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-top"><span>Total Paid Amount</span></div>
                    {renderCurrencyBreakdown(activeCustomer.total_paid || {})}
                    <span className="stat-subtext">Verified collected revenue</span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-top"><span>Outstanding Balance</span></div>
                    {renderCurrencyBreakdown(activeCustomer.outstanding || {}, Object.keys(activeCustomer.outstanding || {}).length > 0)}
                    <span className="stat-subtext">Draft and unpaid invoices</span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-top"><span>Overdue Invoices</span></div>
                    <div className="currency-primary-line">
                      <span className={`currency-amt ${(activeCustomer.overdue_invoices || 0) > 0 ? "text-danger" : ""}`}>
                        {activeCustomer.overdue_invoices || 0}
                      </span>
                    </div>
                    <span className="stat-subtext" style={{ color: (activeCustomer.overdue_invoices || 0) > 0 ? "#b91c1c" : "inherit" }}>
                      {(activeCustomer.overdue_invoices || 0) > 0 ? "Requires attention" : "All payments on schedule"}
                    </span>
                  </div>
                </div>

                {/* Contact & Profile Details Card */}
                <div className="panel customer-details-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Customer details</h3>
                      <p>Contact information and client profile notes</p>
                    </div>
                  </div>

                  <div className="customer-info-grid">
                    <div className="info-block">
                      <span className="info-label">Email Address</span>
                      <a href={`mailto:${activeCustomer.email}`} className="info-val link">{activeCustomer.email}</a>
                    </div>
                    <div className="info-block">
                      <span className="info-label">Phone Number</span>
                      <span className="info-val">{activeCustomer.phone || "—"}</span>
                    </div>
                    <div className="info-block">
                      <span className="info-label">Company / Organization</span>
                      <span className="info-val">{activeCustomer.company || "Individual Client"}</span>
                    </div>
                    <div className="info-block">
                      <span className="info-label">Billing Address</span>
                      <span className="info-val">{activeCustomer.address || "—"}</span>
                    </div>
                    <div className="info-block">
                      <span className="info-label">Customer Since</span>
                      <span className="info-val">{new Date(activeCustomer.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className="info-block">
                      <span className="info-label">Last Updated</span>
                      <span className="info-val">{new Date(activeCustomer.updated_at).toLocaleDateString()}</span>
                    </div>
                    {activeCustomer.notes && (
                      <div className="info-block full-width">
                        <span className="info-label">Notes & Instructions</span>
                        <p className="info-notes">{activeCustomer.notes}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Customer Invoice History Ledger */}
                <div className="panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Associated Invoices</h3>
                      <p>Complete historical ledger of customer invoices and payment states</p>
                    </div>
                    <button
                      type="button"
                      className="period-btn"
                      onClick={() => openCreateInvoice(activeCustomer)}
                    >
                      <IconPlus width={15} height={15} /> Create Invoice
                    </button>
                  </div>

                  {savedInvoices.filter(i => (i.customer_id === activeCustomer.id) || (i.email && i.email.trim().toLowerCase() === activeCustomer.email.trim().toLowerCase())).length === 0 ? (
                    <div className="empty-state">
                      <h3>No invoices yet</h3>
                      <p>This customer does not have any recorded invoices.</p>
                      <button
                        type="button"
                        className="create-btn"
                        onClick={() => openCreateInvoice(activeCustomer)}
                      >
                        Create First Invoice
                      </button>
                    </div>
                  ) : (
                    <div className="invoices-list">
                      {savedInvoices
                        .filter(i => (i.customer_id === activeCustomer.id) || (i.email && i.email.trim().toLowerCase() === activeCustomer.email.trim().toLowerCase()))
                        .map(invoice => {
                          const statusClass = (invoice.status || "draft").toLowerCase();
                          return (
                            <div className="invoice-list-row" key={invoice.id}>
                              <div>
                                <strong
                                  style={{ cursor: "pointer", color: "#2563eb", textDecoration: "underline" }}
                                  onClick={() => { setSearchTerm(invoice.id); setPage("Invoices"); }}
                                  title="View invoice in Invoices manager"
                                >
                                  {invoice.id}
                                </strong>
                                <p style={{ fontSize: "12px", color: "#64748b" }}>
                                  {invoice.items ? `${invoice.items.length} line item${invoice.items.length === 1 ? '' : 's'}` : "1 line item"}
                                  {invoice.due_date ? ` · Due: ${invoice.due_date}` : ""}
                                </p>
                              </div>

                              <strong>{formatCurrency(invoice.total, invoice.currency)}</strong>

                              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                <span className={`table-status ${statusClass}`}>{invoice.status}</span>
                                {isInvoiceOverdue(invoice) && (
                                  <span className="table-status overdue">Overdue</span>
                                )}
                              </div>

                              <button
                                type="button"
                                className="period-btn"
                                onClick={() => { setSearchTerm(invoice.id); setPage("Invoices"); }}
                              >
                                View in Invoices →
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Modal: Add or Edit Customer */}
        {isCustomerModalOpen && (
          <div className="customer-modal-backdrop" onClick={closeCustomerModal}>
            <div className="customer-modal" onClick={e => e.stopPropagation()}>
              <div className="customer-modal-header">
                <div>
                  <h3>{editingCustomer ? "Edit Customer Profile" : "Register New Customer"}</h3>
                  <p>{editingCustomer ? `Editing details for ${editingCustomer.name}` : "Create a reusable client contact and billing profile."}</p>
                </div>
                <button type="button" className="close-modal-btn" onClick={closeCustomerModal}><IconClose width={14} height={14} /></button>
              </div>

              {customerFormError && (
                <div className="customer-modal-error">
                  <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><IconAlert width={15} height={15} /> {customerFormError}</span>
                </div>
              )}

              <form onSubmit={handleCustomerFormSubmit} className="customer-modal-form">
                <div className="modal-form-grid">
                  <label>Full Name *
                    <input
                      type="text"
                      placeholder="e.g. Acme Corporation or Jane Doe"
                      value={customerFormData.name}
                      onChange={e => setCustomerFormData(prev => ({ ...prev, name: e.target.value }))}
                      required
                    />
                  </label>

                  <label>Email Address *
                    <input
                      type="email"
                      placeholder="e.g. billing@acme.com"
                      value={customerFormData.email}
                      onChange={e => setCustomerFormData(prev => ({ ...prev, email: e.target.value }))}
                      required
                    />
                  </label>

                  <label>Company / Organization
                    <input
                      type="text"
                      placeholder="e.g. Acme Inc."
                      value={customerFormData.company}
                      onChange={e => setCustomerFormData(prev => ({ ...prev, company: e.target.value }))}
                    />
                  </label>

                  <label>Phone Number
                    <input
                      type="tel"
                      placeholder="e.g. +1 555-0199"
                      value={customerFormData.phone}
                      onChange={e => setCustomerFormData(prev => ({ ...prev, phone: e.target.value }))}
                    />
                  </label>

                  <label className="full-col">Billing Address
                    <input
                      type="text"
                      placeholder="e.g. 100 Main St, Suite 400, New York, NY 10001"
                      value={customerFormData.address}
                      onChange={e => setCustomerFormData(prev => ({ ...prev, address: e.target.value }))}
                    />
                  </label>

                  <label className="full-col">Customer Notes
                    <textarea
                      rows="3"
                      placeholder="Internal notes, preferred currency, billing terms, etc."
                      value={customerFormData.notes}
                      onChange={e => setCustomerFormData(prev => ({ ...prev, notes: e.target.value }))}
                    />
                  </label>
                </div>

                <div className="customer-modal-actions">
                  <button type="button" className="period-btn" onClick={closeCustomerModal} disabled={customerSubmitting}>
                    Cancel
                  </button>
                  <button type="submit" className="create-btn" disabled={customerSubmitting}>
                    {customerSubmitting ? "Saving..." : (editingCustomer ? "Update Customer" : "Create Customer")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

                {page === "Reports" && (
          <>
            <header className="topbar reports-topbar">
              <div className="topbar-left">
                <p className="breadcrumb">Workspace / Reports & Analytics</p>
                <h1>Financial Reports & Analytics</h1>
                <p className="page-subtitle">Real-time revenue metrics, multi-currency accounting breakdown, and payment audit logs.</p>
              </div>
              <div className="top-actions">
                <button
                  type="button"
                  className="period-btn"
                  onClick={() => loadReportsAnalytics(reportsDateRange, reportsCurrencyFilter)}
                  title="Reload analytics data"
                >
                  <IconRefresh width={14} height={14} /> Refresh
                </button>
                <button
                  type="button"
                  className="create-btn export-btn"
                  onClick={handleExportCsv}
                  title="Download complete financial report as CSV"
                >
                  <IconDownload width={14} height={14} /> Export to CSV
                </button>
              </div>
            </header>

            {/* Interactive Filters Bar */}
            <div className="panel reports-filter-panel">
              <div className="reports-filter-row">
                <div className="filter-item">
                  <label htmlFor="report-range-select">Time Range:</label>
                  <select
                    id="report-range-select"
                    value={reportsDateRange}
                    onChange={e => {
                      const val = e.target.value;
                      setReportsDateRange(val);
                      loadReportsAnalytics(val, reportsCurrencyFilter);
                    }}
                  >
                    <option value="all">All Time</option>
                    <option value="30d">Last 30 Days</option>
                    <option value="90d">Last 90 Days</option>
                    <option value="year">This Year (YTD)</option>
                  </select>
                </div>

                <div className="filter-item">
                  <label htmlFor="report-currency-select">Currency:</label>
                  <select
                    id="report-currency-select"
                    value={reportsCurrencyFilter}
                    onChange={e => {
                      const val = e.target.value;
                      setReportsCurrencyFilter(val);
                      loadReportsAnalytics(reportsDateRange, val);
                    }}
                  >
                    <option value="all">All Currencies</option>
                    {(reportsAnalytics?.currencies || ["USD", "INR"]).map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div className="filter-meta">
                  <span>Filtered: <strong>{reportsAnalytics?.total_invoices_count || 0}</strong> invoices analyzed</span>
                </div>
              </div>
            </div>

            {reportsLoading ? (
              <div className="table-loading-state">
                <div className="spinner-small"></div>
                <span>Computing financial analytics across SQLite ledgers...</span>
              </div>
            ) : reportsError ? (
              <div className="invoices-error-banner">
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><IconAlert width={15} height={15} /> {reportsError}</span>
                <button type="button" className="retry-btn" onClick={() => loadReportsAnalytics(reportsDateRange, reportsCurrencyFilter)}>Retry</button>
              </div>
            ) : !reportsAnalytics ? (
              <div className="empty-state">
                <h3>No analytics data available</h3>
              </div>
            ) : (
              <>
                {/* 4 Primary Financial Cards */}
                <div className="stats reports-stats-grid">
                  <div className="stat-card">
                    <div className="stat-top"><span>Total Paid Revenue</span></div>
                    {renderCurrencyBreakdown(reportsAnalytics.revenue_overview?.total_paid || {})}
                    <span className="stat-subtext">Verified collected revenue</span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-top"><span>Outstanding Balances</span></div>
                    {renderCurrencyBreakdown(reportsAnalytics.revenue_overview?.total_outstanding || {})}
                    <span className="stat-subtext">Unsettled drafts & pending checkouts</span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-top"><span>Overdue Invoices</span></div>
                    {renderCurrencyBreakdown(
                      reportsAnalytics.revenue_overview?.total_overdue || {},
                      Object.keys(reportsAnalytics.revenue_overview?.total_overdue || {}).length > 0
                    )}
                    <span className="stat-subtext" style={{ color: Object.keys(reportsAnalytics.revenue_overview?.total_overdue || {}).length > 0 ? "#b91c1c" : "inherit" }}>
                      {reportsAnalytics.status_distribution?.Overdue?.count || 0} overdue invoices requiring action
                    </span>
                  </div>
                  <div className="stat-card">
                    <div className="stat-top"><span>Payment Success Rate</span></div>
                    <h2>{reportsAnalytics.payments_stats?.success_rate_percent || 100}%</h2>
                    <span className="stat-subtext">
                      {reportsAnalytics.payments_stats?.completed_count || 0} completed of {reportsAnalytics.payments_stats?.total_transactions || 0} checkout attempts
                    </span>
                  </div>
                </div>

                {/* Analytical Charts & Breakdowns Grid */}
                <div className="reports-analytics-grid">
                  {/* Monthly Revenue Trends Chart */}
                  <div className="panel chart-panel">
                    <div className="panel-heading">
                      <div>
                        <h3>Monthly Invoiced vs. Settled Revenue</h3>
                        <p>Timeline of invoiced volume vs. verified PayPal collections</p>
                      </div>
                    </div>

                    {(!reportsAnalytics.monthly_trends || reportsAnalytics.monthly_trends.length === 0) ? (
                      <div className="chart-empty">No monthly records in selected period.</div>
                    ) : (
                      <div className="monthly-chart-container">
                        {reportsAnalytics.monthly_trends.map(m => {
                          const invoicedUsd = m.invoiced?.USD || 0;
                          const paidUsd = m.paid?.USD || 0;
                          const maxVal = Math.max(...reportsAnalytics.monthly_trends.map(x => (x.invoiced?.USD || 0) + (x.paid?.USD || 0)), 100);
                          const invoicedHeight = Math.min(100, Math.round((invoicedUsd / maxVal) * 100));
                          const paidHeight = Math.min(100, Math.round((paidUsd / maxVal) * 100));

                          return (
                            <div className="chart-bar-group" key={m.month}>
                              <div className="bars-wrapper">
                                <div
                                  className="bar bar-invoiced"
                                  style={{ height: `${Math.max(8, invoicedHeight)}%` }}
                                  title={`Invoiced: ${formatAggregatedCurrency(m.invoiced)}`}
                                ></div>
                                <div
                                  className="bar bar-paid"
                                  style={{ height: `${Math.max(8, paidHeight)}%` }}
                                  title={`Paid: ${formatAggregatedCurrency(m.paid)}`}
                                ></div>
                              </div>
                              <span className="chart-label">{m.month}</span>
                              <span className="chart-amount">{formatAggregatedCurrency(m.paid)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="chart-legend">
                      <div className="legend-item"><span className="legend-color invoiced"></span> Invoiced Value</div>
                      <div className="legend-item"><span className="legend-color paid"></span> Settled Revenue</div>
                    </div>
                  </div>

                  {/* Invoice Status Distribution */}
                  <div className="panel chart-panel">
                    <div className="panel-heading">
                      <div>
                        <h3>Invoice Status Breakdown</h3>
                        <p>Distribution of draft, pending, paid and overdue invoices</p>
                      </div>
                    </div>

                    <div className="status-bars-list">
                      {["Paid", "Draft", "Pending", "Overdue"].map(st => {
                        const count = reportsAnalytics.status_distribution?.[st]?.count || 0;
                        const amounts = reportsAnalytics.status_distribution?.[st]?.amounts || {};
                        const totalInvCount = reportsAnalytics.total_invoices_count || 1;
                        const pct = Math.round((count / totalInvCount) * 100);
                        const colorClass = st.toLowerCase();

                        return (
                          <div className="status-bar-row" key={st}>
                            <div className="status-bar-header">
                              <span className={`status-badge-mini ${colorClass}`}>{st}</span>
                              <span className="status-count-info">{count} invoice{count === 1 ? '' : 's'} ({pct}%)</span>
                              <strong className="status-amt-info">{formatAggregatedCurrency(amounts)}</strong>
                            </div>
                            <div className="progress-track">
                              <div className={`progress-fill ${colorClass}`} style={{ width: `${pct}%` }}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Outstanding Payment Aging Analysis */}
                <div className="panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Outstanding Aging Analysis</h3>
                      <p>Receivables breakdown by due date status</p>
                    </div>
                  </div>

                  <div className="aging-grid">
                    <div className="aging-card current">
                      <span className="aging-tag">Current / On Schedule</span>
                      <h4>{formatAggregatedCurrency(reportsAnalytics.outstanding_aging?.current || {})}</h4>
                      <p>Invoices within active payment terms</p>
                    </div>
                    <div className="aging-card warning">
                      <span className="aging-tag">Overdue 1–30 Days</span>
                      <h4>{formatAggregatedCurrency(reportsAnalytics.outstanding_aging?.overdue_1_30_days || {})}</h4>
                      <p>Recently passed due date</p>
                    </div>
                    <div className="aging-card critical">
                      <span className="aging-tag">Overdue 30+ Days</span>
                      <h4>{formatAggregatedCurrency(reportsAnalytics.outstanding_aging?.overdue_30_plus_days || {})}</h4>
                      <p>Delinquent invoices requiring follow-up</p>
                    </div>
                  </div>
                </div>

                {/* Customer-Wise Revenue Breakdown Table */}
                <div className="panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Customer-Wise Revenue Ledger</h3>
                      <p>Revenue and receivables aggregated per client entity</p>
                    </div>
                  </div>

                  <div className="reports-table-wrapper">
                    <div className="reports-table-header">
                      <div className="col-cust-name">Customer Contact</div>
                      <div className="col-cust-invs">Invoices</div>
                      <div className="col-cust-paid">Total Paid</div>
                      <div className="col-cust-outstanding">Outstanding</div>
                      <div className="col-cust-action">Action</div>
                    </div>

                    {(!reportsAnalytics.customer_breakdown || reportsAnalytics.customer_breakdown.length === 0) ? (
                      <div className="empty-state">No customer invoice records found.</div>
                    ) : (
                      reportsAnalytics.customer_breakdown.map(c => {
                        const paidEntries = Object.entries(c.paid || {}).filter(([_, a]) => Number(a) > 0);
                        const outstandingEntries = Object.entries(c.outstanding || {}).filter(([_, a]) => Number(a) > 0);

                        return (
                          <div className="reports-table-row" key={`${c.name}_${c.email}`}>
                            <div className="col-cust-name">
                              <span className="cust-display-name">{c.name}</span>
                              <span className="cust-display-email" title={c.email}>{c.email}</span>
                            </div>
                            <div className="col-cust-invs">
                              <span className="count-pill">{c.invoices_count}</span>
                            </div>
                            <div className="col-cust-paid">
                              {paidEntries.length === 0 ? (
                                <span className="text-muted font-mono">{formatCurrency(0, "USD")}</span>
                              ) : (
                                paidEntries.map(([curr, amt]) => (
                                  <span key={curr} className="text-success font-mono">
                                    {formatCurrency(amt, curr)}
                                  </span>
                                ))
                              )}
                            </div>
                            <div className="col-cust-outstanding">
                              {outstandingEntries.length === 0 ? (
                                <span className="text-muted font-mono">{formatCurrency(0, "USD")}</span>
                              ) : (
                                outstandingEntries.map(([curr, amt]) => (
                                  <span key={curr} className="text-warning-bold font-mono">
                                    {formatCurrency(amt, curr)}
                                  </span>
                                ))
                              )}
                            </div>
                            <div className="col-cust-action">
                              <button
                                type="button"
                                className="period-btn btn-sm customer-filter-btn"
                                onClick={() => { setSearchTerm(c.email); setPage("Invoices"); }}
                                title={`Filter invoices for ${c.name}`}
                              >
                                Filter Invoices →
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}

                {page === "Settings" && (
          <>
            <header className="topbar settings-topbar">
              <div className="topbar-left">
                <p className="breadcrumb">Workspace / Settings</p>
                <h1>Application & Business Settings</h1>
                <p className="page-subtitle">Configure your merchant profile, default invoice currency, payment terms, and gateway preferences.</p>
              </div>
            </header>

            {settingsSuccessMsg && (
              <div className="ai-success-banner" style={{ marginBottom: "20px" }}>
                <span>{settingsSuccessMsg}</span>
                <button type="button" onClick={() => setSettingsSuccessMsg("")}><IconClose width={14} height={14} /></button>
              </div>
            )}

            {settingsErrorMsg && (
              <div className="ai-error-banner" style={{ marginBottom: "20px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><IconAlert width={15} height={15} /> {settingsErrorMsg}</span>
                <button type="button" onClick={() => setSettingsErrorMsg("")}><IconClose width={14} height={14} /></button>
              </div>
            )}

            <form onSubmit={handleSaveSettings} className="settings-layout">
              {/* Business Profile Panel */}
              <div className="panel settings-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Merchant Business Profile</h3>
                    <p>Details displayed on generated customer invoices and billing statements</p>
                  </div>
                </div>

                <div className="settings-form-grid">
                  <label>Business / Merchant Name *
                    <input
                      type="text"
                      value={appSettings.business_name || ""}
                      onChange={e => setAppSettings(prev => ({ ...prev, business_name: e.target.value }))}
                      placeholder="e.g. Acme Corporation"
                      required
                    />
                  </label>

                  <label>Billing Email Address *
                    <input
                      type="email"
                      value={appSettings.business_email || ""}
                      onChange={e => setAppSettings(prev => ({ ...prev, business_email: e.target.value }))}
                      placeholder="billing@example.com"
                      required
                    />
                  </label>

                  <label>Business Phone Number
                    <input
                      type="tel"
                      value={appSettings.business_phone || ""}
                      onChange={e => setAppSettings(prev => ({ ...prev, business_phone: e.target.value }))}
                      placeholder="+1 (555) 019-2834"
                    />
                  </label>

                  <label>Tax ID / Business Registration
                    <input
                      type="text"
                      value={appSettings.tax_id || ""}
                      onChange={e => setAppSettings(prev => ({ ...prev, tax_id: e.target.value }))}
                      placeholder="e.g. US-TAX-1234567"
                    />
                  </label>

                  <label className="full-col">Business Physical Address
                    <input
                      type="text"
                      value={appSettings.business_address || ""}
                      onChange={e => setAppSettings(prev => ({ ...prev, business_address: e.target.value }))}
                      placeholder="123 Financial Way, Suite 400, New York, NY 10001"
                    />
                  </label>
                </div>
              </div>

              {/* Invoicing Preferences Panel */}
              <div className="panel settings-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Invoicing Preferences</h3>
                    <p>Default parameters applied to newly created invoices and AI drafts</p>
                  </div>
                </div>

                <div className="settings-form-grid">
                  <label>Default Currency
                    <select
                      value={appSettings.default_currency || "USD"}
                      onChange={e => setAppSettings(prev => ({ ...prev, default_currency: e.target.value }))}
                    >
                      <option value="USD">USD ($) — US Dollar</option>
                      <option value="EUR">EUR (€) — Euro</option>
                      <option value="GBP">GBP (£) — British Pound</option>
                      <option value="INR">INR (₹) — Indian Rupee</option>
                      <option value="CAD">CAD ($) — Canadian Dollar</option>
                      <option value="AUD">AUD ($) — Australian Dollar</option>
                    </select>
                  </label>

                  <label>Default Payment Terms (Due Days)
                    <select
                      value={appSettings.default_due_days || 30}
                      onChange={e => setAppSettings(prev => ({ ...prev, default_due_days: Number(e.target.value) }))}
                    >
                      <option value={15}>Net 15 Days</option>
                      <option value={30}>Net 30 Days (Standard)</option>
                      <option value={45}>Net 45 Days</option>
                      <option value={60}>Net 60 Days</option>
                    </select>
                  </label>

                  <label>Invoice Number Prefix
                    <input
                      type="text"
                      value={appSettings.invoice_prefix || "INV-"}
                      onChange={e => setAppSettings(prev => ({ ...prev, invoice_prefix: e.target.value }))}
                      placeholder="INV-"
                      required
                    />
                  </label>

                  <label className="full-col">Default Invoice Notes & Payment Terms
                    <textarea
                      rows="3"
                      value={appSettings.default_notes || ""}
                      onChange={e => setAppSettings(prev => ({ ...prev, default_notes: e.target.value }))}
                      placeholder="Thank you for your business. Payment terms..."
                    />
                  </label>
                </div>
              </div>

              {/* Security & Sandbox Compliance Matrix */}
              <div className="panel settings-panel">
                <div className="panel-heading">
                  <div>
                    <h3>PayPal Gateway Guardrails & Compliance</h3>
                    <p>Deterministic runtime security policies, sandbox boundary enforcement, and credential readiness</p>
                  </div>
                  <span className="security-shield-badge">
                    <IconShield width={14} height={14} /> Strict Sandbox Active
                  </span>
                </div>

                <div className="settings-guardrails-grid">
                  {/* Card 1: Runtime Policy */}
                  <div className="guardrail-card">
                    <div className="guardrail-card-top">
                      <span className="guardrail-icon-box policy"><IconShield width={16} height={16} /></span>
                      <div>
                        <h4>Gateway Execution Policy</h4>
                        <span className="guardrail-tag strict">STRICT SANDBOX ONLY</span>
                      </div>
                    </div>
                    <p className="guardrail-desc">
                      All outbound payment requests are cryptographically restricted to PayPal Sandbox hosts. Production/live URLs and unauthorized domains are rejected at runtime.
                    </p>
                    <div className="guardrail-footer">
                      <span className="guardrail-indicator active">✓ Live Mode Blocked</span>
                    </div>
                  </div>

                  {/* Card 2: Credential State */}
                  <div className="guardrail-card">
                    <div className="guardrail-card-top">
                      <span className="guardrail-icon-box credentials"><IconAlert width={16} height={16} /></span>
                      <div>
                        <h4>Sandbox Credentials Status</h4>
                        <span className={`guardrail-tag ${systemHealth.paypal_configured ? "active" : "pending"}`}>
                          {systemHealth.paypal_configured ? "CREDENTIALS CONFIGURED" : "CREDENTIALS NOT CONFIGURED"}
                        </span>
                      </div>
                    </div>
                    <p className="guardrail-desc">
                      {systemHealth.paypal_configured
                        ? "Valid PayPal Sandbox Client ID and Secret are loaded in backend environment."
                        : "PayPal Developer sandbox credentials pending setup. Real sandbox checkout is held until developer credentials are provided in backend environment."}
                    </p>
                    <div className="guardrail-footer">
                      <span className={`guardrail-indicator ${systemHealth.paypal_configured ? "active" : "pending"}`}>
                        {systemHealth.paypal_configured ? "✓ Ready for Sandbox Orders" : "⚠️ Developer Account Pending"}
                      </span>
                    </div>
                  </div>

                  {/* Card 3: Enforced Endpoint */}
                  <div className="guardrail-card">
                    <div className="guardrail-card-top">
                      <span className="guardrail-icon-box endpoint"><IconExternal width={16} height={16} /></span>
                      <div>
                        <h4>Enforced Sandbox API Base</h4>
                        <span className="guardrail-tag verified">VERIFIED ENDPOINT</span>
                      </div>
                    </div>
                    <div className="guardrail-endpoint-code">
                      <code>https://api-m.sandbox.paypal.com</code>
                    </div>
                    <div className="guardrail-footer">
                      <span className="guardrail-indicator active">✓ TLS Encrypted Host</span>
                    </div>
                  </div>

                  {/* Card 4: Settlement Integrity */}
                  <div className="guardrail-card">
                    <div className="guardrail-card-top">
                      <span className="guardrail-icon-box settlement"><IconCheckCircle width={16} height={16} /></span>
                      <div>
                        <h4>Data Settlement & Audit Rule</h4>
                        <span className="guardrail-tag audit">SERVER-VERIFIED CAPTURE</span>
                      </div>
                    </div>
                    <p className="guardrail-desc">
                      Invoices and payment records transition to <code>Completed</code> / <code>Paid</code> exclusively via verified server-side PayPal Sandbox capture responses. Order creation never completes payment.
                    </p>
                    <div className="guardrail-footer">
                      <span className="guardrail-indicator active">✓ Audit Protection Active</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-action-bar">
                <button type="submit" className="create-btn save-settings-btn" disabled={settingsSaving}>
                  {settingsSaving ? "Saving Preferences..." : "Save Settings"}
                </button>
              </div>
            </form>
          </>
        )}

        {page !== "Overview" && page !== "Invoices" && page !== "Create Invoice" && page !== "AI Copilot" && page !== "Payments" && page !== "Customers" && page !== "Reports" && page !== "Settings" && (
          <div className="panel coming-soon">
            <h1>{page}</h1>
            <p>This section is coming soon. We're building it for PayPilot AI.</p>
            <button className="create-btn" onClick={() => setPage("Overview")}>Back to dashboard</button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
