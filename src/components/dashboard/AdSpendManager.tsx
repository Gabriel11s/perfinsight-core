import { useState } from 'react';
import { format, startOfMonth, subMonths, addMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAdSpend, useUpsertAdSpend, useDeleteAdSpend, DEFAULT_CHANNELS } from '@/hooks/use-ad-spend';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DollarSign,
  Plus,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatMonth(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  return format(d, 'MMM yyyy', { locale: ptBR });
}

export function AdSpendManager() {
  const { toast } = useToast();
  const { data: rows = [], isLoading } = useAdSpend();
  const upsert = useUpsertAdSpend();
  const remove = useDeleteAdSpend();

  // Form state
  const [selectedMonth, setSelectedMonth] = useState(() =>
    format(startOfMonth(new Date()), 'yyyy-MM-dd')
  );
  const [channel, setChannel] = useState(DEFAULT_CHANNELS[0]);
  const [customChannel, setCustomChannel] = useState('');
  const [amount, setAmount] = useState('');

  // View month navigation
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));

  const viewMonthStr = format(viewMonth, 'yyyy-MM-dd');
  const monthRows = rows.filter((r) => r.period === viewMonthStr);
  const totalMonth = monthRows.reduce((sum, r) => sum + Number(r.amount), 0);

  async function handleAdd() {
    const ch = channel === '__custom__' ? customChannel.trim() : channel;
    const amt = parseFloat(amount);
    if (!ch) {
      toast({ title: 'Selecione um canal', variant: 'destructive' });
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      toast({ title: 'Informe um valor válido', variant: 'destructive' });
      return;
    }

    try {
      await upsert.mutateAsync({ channel: ch, period: selectedMonth, amount: amt });
      toast({ title: `${formatCurrency(amt)} adicionado para ${ch}` });
      setAmount('');
    } catch (e: any) {
      toast({ title: 'Erro ao salvar', description: e.message, variant: 'destructive' });
    }
  }

  async function handleDelete(id: string) {
    try {
      await remove.mutateAsync(id);
      toast({ title: 'Registro removido' });
    } catch (e: any) {
      toast({ title: 'Erro ao remover', description: e.message, variant: 'destructive' });
    }
  }

  // Generate month options (last 12 months + next month)
  const monthOptions: { value: string; label: string }[] = [];
  for (let i = -1; i <= 12; i++) {
    const d = startOfMonth(subMonths(new Date(), i));
    monthOptions.push({
      value: format(d, 'yyyy-MM-dd'),
      label: format(d, 'MMMM yyyy', { locale: ptBR }),
    });
  }

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────── */}
      <div className="flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Investimento em Ads</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Insira os valores investidos por canal/mês. Esses dados são usados para calcular ROI, CPL e CPA no módulo Marketing.
      </p>

      {/* ── Add form ─────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end rounded-lg border bg-card p-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Mês</Label>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Canal</Label>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DEFAULT_CHANNELS.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
              <SelectItem value="__custom__">Outro...</SelectItem>
            </SelectContent>
          </Select>
          {channel === '__custom__' && (
            <Input
              placeholder="Nome do canal"
              value={customChannel}
              onChange={(e) => setCustomChannel(e.target.value)}
              className="mt-1"
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Valor (R$)</Label>
          <div className="relative">
            <DollarSign className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        <Button onClick={handleAdd} disabled={upsert.isPending} className="gap-1.5">
          {upsert.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Adicionar
        </Button>
      </div>

      {/* ── Month navigator + table ─────────────── */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => setViewMonth(subMonths(viewMonth, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium capitalize">
            {format(viewMonth, 'MMMM yyyy', { locale: ptBR })}
          </span>
          <Button variant="ghost" size="icon" onClick={() => setViewMonth(addMonths(viewMonth, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : monthRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum investimento registrado para este mês.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Canal</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.channel}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(Number(row.amount))}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(row.id)}
                      disabled={remove.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(totalMonth)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
