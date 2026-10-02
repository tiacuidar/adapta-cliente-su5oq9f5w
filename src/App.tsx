/* Main App Component - Handles routing (using react-router-dom), query client and other providers - use this file to add all routes */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import Agenda from './pages/Agenda'
import Index from './pages/Index'
import Login from './pages/Login'
import Fila from './pages/Fila'
import NovaReuniao from './pages/NovaReuniao'
import Painel from './pages/Painel'
import NotFound from './pages/NotFound'
import Layout from './components/Layout'
import pb from '@/lib/pocketbase/client'

// ONLY IMPORT AND RENDER WORKING PAGES, NEVER ADD PLACEHOLDER COMPONENTS OR PAGES IN THIS FILE
// AVOID REMOVING ANY CONTEXT PROVIDERS FROM THIS FILE (e.g. TooltipProvider, Toaster, Sonner)

// LT-1-T01 — Guard de rota: não autenticado → /login
const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  if (!pb.authStore.isValid) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

const App = () => (
  <BrowserRouter>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route
            path="/"
            element={
              <RequireAuth>
                <Index />
              </RequireAuth>
            }
          />
          <Route
            path="/reunioes/nova"
            element={
              <RequireAuth>
                <NovaReuniao />
              </RequireAuth>
            }
          />
          <Route
            path="/fila"
            element={
              <RequireAuth>
                <Fila />
              </RequireAuth>
            }
          />
          <Route
            path="/painel"
            element={
              <RequireAuth>
                <Painel />
              </RequireAuth>
            }
          />
          <Route
            path="/agenda"
            element={
              <RequireAuth>
                <Agenda />
              </RequireAuth>
            }
          />
          {/* ADD ALL CUSTOM ROUTES MUST BE ADDED HERE */}
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </TooltipProvider>
  </BrowserRouter>
)

export default App
