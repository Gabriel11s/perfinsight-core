import { useState, ReactNode } from 'react';
import { AppSidebar } from './AppSidebar';
import { Topbar } from './Topbar';
import { useAuth } from '@/hooks/use-auth';
import TenantSetup from '@/components/TenantSetup';

export function AppLayout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { tenant } = useAuth();

  if (!tenant) {
    return <TenantSetup />;
  }

  return (
    <div className="flex min-h-screen w-full">
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col min-w-0 lg:ml-[220px]">
        <Topbar onMenuToggle={() => setSidebarOpen(o => !o)} />
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
