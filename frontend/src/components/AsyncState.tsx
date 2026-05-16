import type { ReactNode } from "react";

export function AsyncState(props: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  children: ReactNode;
}) {
  if (props.loading)
    return <div className="p-6 text-slate-500">Carregando…</div>;
  if (props.error)
    return <div className="p-6 text-red-600">Erro: {props.error}</div>;
  if (props.empty)
    return <div className="p-6 text-slate-500">Nenhum dado encontrado.</div>;
  return <>{props.children}</>;
}
