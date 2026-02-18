import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import StatusPagesIndex from "./pages/StatusPagesIndex";
import StatusPageDetail from "./pages/StatusPageDetail";
import AdminNewPage from "./pages/AdminNewPage";
import AdminServices from "./pages/AdminServices";
import ResourcesPage from "./pages/ResourcesPage";
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
          <Route path="/new" element={<AdminNewPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/:slug/edit" element={<AdminServices />} />
          
          <Route path="/:slug" element={<StatusPageDetail />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
