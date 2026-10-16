import React, { createContext, useContext, useLayoutEffect, useRef, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { dialogStack } from '../../features/navigation/dialogStack';

const DialogDepth = createContext(0);
const FOCUSABLE = 'button, a[href], input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])';
const surfaces = new Map<string, HTMLElement>();
const inertBefore = new Map<HTMLElement, boolean>();

function activeSurface() {
  const id = dialogStack.top()?.id;
  return id ? surfaces.get(id) : undefined;
}

export const isTopDialogElement = (element: HTMLElement | null) => activeSurface() === element;

function focusable(surface: HTMLElement) {
  return Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(element =>
    !element.matches(':disabled, [hidden], [aria-disabled="true"]') &&
    !element.closest('[inert], [hidden]') && element.getClientRects().length > 0);
}

function focusInside(surface: HTMLElement) {
  const initial = surface.querySelector<HTMLElement>('[data-dialog-initial-focus]');
  const target = initial || focusable(surface)[0] || surface;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function syncBackground() {
  const active = activeSurface();
  for (const [element, original] of inertBefore) element.inert = original;
  inertBefore.clear();
  if (!active) return;
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement) || child === active || child.contains(active)) continue;
    if (active.dataset.dialogBlocking === 'false' && !child.hasAttribute('data-dialog-layer')) continue;
    inertBefore.set(child, child.inert);
    child.inert = true;
  }
  const ordered = dialogStack.entries().sort((left, right) => left.depth - right.depth);
  for (const [index, entry] of ordered.entries()) {
    const surface = surfaces.get(entry.id);
    if (!surface) continue;
    // Une surface non bloquante (la fiche média) conserve son z-index déclaré afin que
    // la BottomNav reste au-dessus. Seuls les vrais dialogues bloquants sont promus
    // dans la pile de portails.
    if (surface.dataset.dialogBlocking === 'false') surface.style.removeProperty('z-index');
    else surface.style.zIndex = String(1000 + index);
    if (surface.dataset.dialogBlocking === 'true') surface.setAttribute('aria-modal', String(entry.id === dialogStack.top()?.id));
    else surface.removeAttribute('aria-modal');
  }
}

function handleKey(event: KeyboardEvent) {
  const surface = activeSurface();
  if (!surface) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    dialogStack.closeTop();
  } else if (event.key === 'Tab') {
    if (surface.dataset.dialogBlocking === 'false') return;
    const items = focusable(surface);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (!items.length || (event.shiftKey ? index <= 0 : index < 0 || index === items.length - 1)) {
      event.preventDefault();
      (event.shiftKey ? items.at(-1) : items[0])?.focus();
      if (!items.length) surface.focus();
    }
  }
}

function handleFocus(event: FocusEvent) {
  const surface = activeSurface();
  if (surface && surface.dataset.dialogBlocking !== 'false' && !surface.contains(event.target as Node)) focusInside(surface);
}

interface DialogLayerProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>;
  onDismiss: () => void;
  label: string;
  historyMode?: 'local' | 'external';
  canDismiss?: boolean;
  blocking?: boolean;
}

/** Chaque dialogue est un portail body, un niveau Retour et une frontière de focus. */
export function DialogLayer({ onDismiss, label, historyMode = 'local', canDismiss = true, blocking = true, children, ref: forwardedRef, ...props }: DialogLayerProps) {
  const parentDepth = useContext(DialogDepth);
  const depth = parentDepth + 1;
  const id = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [registered, setRegistered] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const canDismissRef = useRef(canDismiss);
  canDismissRef.current = canDismiss;

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Les parents historiques (épisode/personne) gardent leurs flags et leur entrée existante.
    const previousState = window.history.state || {};
    if (historyMode === 'local' && window.history.state?.seenitDialog !== id) {
      const state = { ...previousState, seenitDialog: id };
      if (previousState.seenitDialog && !surfaces.has(previousState.seenitDialog)) window.history.replaceState(state, '');
      else window.history.pushState(state, '');
    }
    const remove = dialogStack.add({ id, depth, close: () => {
      if (!canDismissRef.current) {
        dialogStack.acknowledge(id);
        return;
      }
      if (historyMode === 'local' && window.history.state?.seenitDialog === id) window.history.back();
      else dismissRef.current();
    } });
    surfaces.set(id, surface);
    setRegistered(true);
    const onPop = () => {
      if (historyMode === 'local' && window.history.state?.seenitDialog !== id && dialogStack.top()?.id === id) {
        if (canDismissRef.current) dismissRef.current();
        else window.history.pushState({ ...previousState, seenitDialog: id }, '');
      }
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', handleKey, true);
    document.addEventListener('focusin', handleFocus);
    syncBackground();
    const frame = requestAnimationFrame(() => {
      if (activeSurface() === surface) focusInside(surface);
    });
    const updateViewport = () => {
      const viewport = window.visualViewport;
      surface.style.setProperty('--dialog-height', `${viewport?.height ?? window.innerHeight}px`);
      surface.style.setProperty('--dialog-top', `${viewport?.offsetTop ?? 0}px`);
    };
    updateViewport();
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    return () => {
      cancelAnimationFrame(frame);
      const wasTop = activeSurface() === surface;
      remove();
      surfaces.delete(id);
      window.removeEventListener('popstate', onPop);
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      if (!surfaces.size) {
        document.removeEventListener('keydown', handleKey, true);
        document.removeEventListener('focusin', handleFocus);
      }
      syncBackground();
      // StrictMode remonte immédiatement le même id : cette passe ne dépile pas son entrée.
      queueMicrotask(() => {
        if (surfaces.has(id)) return;
        if (historyMode === 'local' && window.history.state?.seenitDialog === id) window.history.back();
        if (wasTop) {
          const next = activeSurface();
          if (trigger?.isConnected && !trigger.closest('[inert]') && (!next || next.contains(trigger))) trigger.focus({ preventScroll: true });
          else if (next) focusInside(next);
        }
      });
    };
  }, [id, depth, historyMode]);

  return createPortal(
    <DialogDepth.Provider value={depth}>
      <div {...props} ref={element => {
        surfaceRef.current = element;
        if (typeof forwardedRef === 'function') forwardedRef(element);
        else if (forwardedRef) forwardedRef.current = element;
      }} data-dialog-depth={depth} data-dialog-layer={id} data-dialog-blocking={blocking}
        role={!blocking ? 'region' : props.role === 'alertdialog' ? 'alertdialog' : 'dialog'} aria-modal={blocking || undefined}
        aria-label={props['aria-label'] || label} tabIndex={-1} className={`seenit-dialog-layer ${props.className || ''}`}>
        {registered ? children : null}
      </div>
    </DialogDepth.Provider>, document.body,
  );
}
