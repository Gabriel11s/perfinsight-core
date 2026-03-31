import { NavLink } from '@/components/NavLink';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import {
  LayoutDashboard, MapPin, Users, Bell, Download, Settings, Zap, X, LogOut, Megaphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

const navSections = [
  {
    label: 'Analytics',
    items: [
      { label: 'Overview', to: '/', icon: LayoutDashboard },
      { label: 'Locations', to: '/locations', icon: MapPin },
      { label: 'Users', to: '/users', icon: Users },
      { label: 'Marketing', to: '/marketing', icon: Megaphone },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Alerts', to: '/alerts', icon: Bell },
      { label: 'Reports', to: '/reports', icon: Download },
    ],
  },
];

interface AppSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function AppSidebar({ open, onClose }: AppSidebarProps) {
  const { user } = useAuth();
  const initials = user?.email?.slice(0, 2).toUpperCase() || '??';

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/auth';
  };

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm lg:hidden" onClick={onClose} />
      )}

      <aside
        className={cn(
          'glass-sidebar fixed inset-y-0 left-0 z-50 flex w-[220px] flex-col transition-transform duration-300 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Logo */}
        <div className="flex h-[60px] items-center gap-2.5 px-5 border-b border-border/40">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 glow-primary">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-foreground font-display">Dashboard Tracker</span>
            <span className="text-[10px] text-muted-foreground -mt-0.5">Analytics</span>
          </div>
          <Button variant="ghost" size="icon" className="ml-auto h-7 w-7 lg:hidden" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {navSections.map(section => (
            <div key={section.label}>
              <p className="px-3 mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className="nav-item relative"
                    activeClassName="active"
                    onClick={onClose}
                  >
                    <item.icon className="h-4 w-4 shrink-0 opacity-70" />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div className="border-t border-border/40 p-3">
          <NavLink
            to="/settings"
            className="nav-item relative mb-2"
            activeClassName="active"
            onClick={onClose}
          >
            <Settings className="h-4 w-4 shrink-0 opacity-70" />
            <span>Settings</span>
          </NavLink>

          <div className="flex items-center gap-2.5 rounded-lg px-3 py-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">
                {user?.email || 'User'}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
