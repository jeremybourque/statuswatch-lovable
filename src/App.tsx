import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import StatusPagesIndex from "./pages/StatusPagesIndex";
import StatusPageDetail from "./pages/StatusPageDetail";
import AuthPage from "./pages/AuthPage";
import CreateStatusPage from "./pages/CreateStatusPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<StatusPagesIndex />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/new" element={<CreateStatusPage />} />
          <Route path="/:slug" element={<StatusPageDetail />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
