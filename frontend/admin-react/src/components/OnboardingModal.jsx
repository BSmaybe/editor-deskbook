import React, { useEffect, useRef, useState } from 'react';
import { Building2, Boxes, Layers3, ChevronRight, ChevronLeft, X } from 'lucide-react';

const STEPS = [
  {
    target: 'button[title="Здания"]',
    icon: <Building2 size={24} />,
    color: '#2563eb',
    title: 'Создайте здание и этажи',
    description: 'Начните отсюда. Добавьте офис, затем этажи — каждый получит свою карту.',
    tab: 'buildings',
  },
  {
    target: 'button[title="Компоненты"]',
    icon: <Boxes size={24} />,
    color: '#7c3aed',
    title: 'Настройте компоненты',
    description: 'Создайте типы мест: столы, переговорки, будки. Задайте внешний вид и размеры.',
    tab: 'components',
  },
  {
    target: 'button[title="План"]',
    icon: <Layers3 size={24} />,
    color: '#059669',
    title: 'Редактируйте план этажа',
    description: 'Выберите этаж, загрузите подложку или сразу рисуйте стены, расставляйте места. Сохраните и опубликуйте.',
    tab: 'layout',
  },
];

const PAD = 6; // spotlight padding around target

export default function OnboardingModal({ onClose, onNavigate }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const tooltipRef = useRef(null);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // Find target element and get its bounding rect
  useEffect(() => {
    function measure() {
      const el = document.querySelector(current.target);
      if (el) setRect(el.getBoundingClientRect());
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step, current.target]);

  // Tooltip position: to the right of the spotlight
  const tooltipStyle = rect ? (() => {
    const top = Math.max(8, rect.top + rect.height / 2 - 110);
    const left = rect.right + PAD + 20;
    return { top, left };
  })() : { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' };

  // Spotlight rect with padding
  const spotStyle = rect ? {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  } : null;

  function finish() {
    onNavigate(current.tab);
    onClose();
  }

  return (
    <div className="ob-root">
      {/* Dark overlay — pointer events blocked except tooltip */}
      <div className="ob-overlay" onClick={onClose} />

      {/* Spotlight cutout */}
      {spotStyle && (
        <div className="ob-spotlight" style={spotStyle} />
      )}

      {/* Tooltip card */}
      <div className="ob-tooltip" style={tooltipStyle} ref={tooltipRef}>
        {/* Arrow pointing left toward the spotlight */}
        <div className="ob-arrow" />

        <button className="ob-close" onClick={onClose}><X size={14} /></button>

        {/* Step dots */}
        <div className="ob-dots">
          {STEPS.map((_, i) => (
            <button
              key={i}
              className={`ob-dot ${i === step ? 'active' : i < step ? 'done' : ''}`}
              onClick={() => setStep(i)}
            />
          ))}
        </div>

        <div className="ob-icon" style={{ background: current.color + '18', color: current.color }}>
          {current.icon}
        </div>

        <h3 className="ob-title">{current.title}</h3>
        <p className="ob-desc">{current.description}</p>

        <div className="ob-actions">
          <button
            className="ob-btn secondary"
            onClick={() => setStep(s => s - 1)}
            disabled={step === 0}
          >
            <ChevronLeft size={15} />
          </button>

          {isLast ? (
            <button className="ob-btn primary" style={{ background: current.color }} onClick={finish}>
              Начать работу <ChevronRight size={15} />
            </button>
          ) : (
            <button className="ob-btn primary" onClick={() => setStep(s => s + 1)}>
              Далее <ChevronRight size={15} />
            </button>
          )}
        </div>

        <button className="ob-skip" onClick={onClose}>Пропустить</button>
      </div>
    </div>
  );
}
