import { Route, Routes } from "react-router";
import { Header } from "./components/Header";
import { ChatPage } from "./pages/ChatPage";
import { InvoicesPage } from "./pages/InvoicesPage";
import { useInvoiceStream } from "./state/useInvoiceStream";

export function App() {
  const stream = useInvoiceStream();
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Routes>
          <Route
            path="/"
            element={
              <InvoicesPage
                onDeleted={stream.removeInvoice}
                onRetry={stream.retryFailed}
                onUploaded={stream.upsertInvoice}
                phase={stream.phase}
                retryPendingIds={stream.retryPendingIds}
                rows={stream.rows}
              />
            }
          />
          <Route path="/chat" element={<ChatPage />} />
        </Routes>
      </main>
    </div>
  );
}
