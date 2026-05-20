import React, { useState } from 'react';
import { Building2, Boxes, Layers3, Mail, ChevronRight, ChevronLeft, X } from 'lucide-react';

const STEPS = [
  {
    icon: <Building2 size={32} />,
    tab: 'buildings',
    title: 'Создайте здание и этажи',
    description: 'Начните с раздела «Здания». Добавьте офис, затем создайте этажи — каждый этаж будет иметь свою карту.',
    action: 'Перейти в Здания',
    color: '#2563eb',
  },
  {
    icon: <Boxes size={32} />,
    tab: 'components',
    title: 'Настройте компоненты',
    description: 'В разделе «Компоненты» создайте типы мест: столы, переговорки, телефонные будки. Задайте их внешний вид и размеры.',
    action: 'Перейти в Компоненты',
    color: '#7c3aed',
  },
  {
    icon: <Layers3 size={32} />,
    tab: 'layout',
    title: 'Нарисуйте план этажа',
    description: 'Выберите этаж в разделе «План». Загрузите подложку (PNG/PDF) для обрисовки или сразу рисуйте стены и расставляйте рабочие места. Сохраните черновик и опубликуйте.',
    action: 'Перейти в План',
    color: '#059669',
  },
  {
    icon: <Mail size={32} />,
    tab: 'invites',
    title: 'Пригласите сотрудников',
    description: 'Создайте пригласительные ссылки для сотрудников. Каждый получит доступ к карте и сможет бронировать рабочие места.',
    action: 'Перейти в Приглашения',
    color: '#d97706',
  },
];

export default function OnboardingModal({ onClose, onNavigate }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  function handleAction() {
    onNavigate(current.tab);
    onClose();
  }

  return (
    <div className="onboarding-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="onboarding-modal">
        <button className="onboarding-close" onClick={onClose} title="Закрыть">
          <X size={18} />
        </button>

        <div className="onboarding-steps-bar">
          {STEPS.map((s, i) => (
            <button
              key={i}
              className={`onboarding-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
              onClick={() => setStep(i)}
            />
          ))}
        </div>

        <div className="onboarding-icon" style={{ color: current.color }}>
          {current.icon}
        </div>

        <div className="onboarding-step-label">Шаг {step + 1} из {STEPS.length}</div>
        <h2 className="onboarding-title">{current.title}</h2>
        <p className="onboarding-desc">{current.description}</p>

        <div className="onboarding-actions">
          <button
            className="onboarding-btn secondary"
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
          >
            <ChevronLeft size={16} /> Назад
          </button>

          {!isLast ? (
            <button className="onboarding-btn primary" onClick={() => setStep((s) => s + 1)}>
              Далее <ChevronRight size={16} />
            </button>
          ) : (
            <button className="onboarding-btn primary" onClick={handleAction} style={{ background: current.color }}>
              Начать <ChevronRight size={16} />
            </button>
          )}
        </div>

        {!isLast && (
          <button className="onboarding-skip" onClick={onClose}>
            Пропустить
          </button>
        )}
      </div>
    </div>
  );
}
