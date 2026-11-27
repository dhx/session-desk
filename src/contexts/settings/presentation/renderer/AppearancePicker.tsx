import React from 'react'
import { CheckIcon } from '@app/renderer/components/ui/pixelIcons'
import { classNames } from '@app/renderer/components/ui/classNames'
import { useTranslation } from '@app/renderer/i18n'
import type { UiTheme } from '@contexts/settings/domain/agentSettings'
import { isBuiltinUiTheme, type BuiltinUiTheme } from '@contexts/settings/domain/uiSettings'
import { APPEARANCE_THUMBNAIL_SIZE, type AppearanceThumbnailMode } from './appearanceThumbnail'
import {
  PLAIN_THUMBNAIL_SIZE,
  PLAIN_THUMBNAIL_SYSTEM_SPLIT,
  plainAppearanceThumbnailShapes,
  plainThumbnailShapePath,
} from './plainAppearanceThumbnail'

/** Picker order: what the app looks like by day, by night, and following the system. */
const APPEARANCES: readonly BuiltinUiTheme[] = ['light', 'dark', 'system']

/** Pixels per thumbnail cell: 2 in a panel, 3 on the settings page. */
const SCALE = { md: 2, lg: 3 } as const

export interface AppearancePickerProps {
  /** The current theme; a plugin theme leaves every appearance unchecked. */
  value: UiTheme
  onValueChange: (theme: BuiltinUiTheme) => void
  labelledBy?: string
  label?: string
  size?: keyof typeof SCALE
  /** The group is `${testIdPrefix}`, each option `${testIdPrefix}-${appearance}`. */
  testIdPrefix: string
  /** Lands on the checked option, or the first while none is: where focus enters the group. */
  entryRef?: React.Ref<HTMLInputElement>
  className?: string
}

function ThumbnailShapes({ appearance }: { appearance: 'light' | 'dark' }): React.JSX.Element {
  return (
    <>
      {plainAppearanceThumbnailShapes(appearance).map(shape => (
        <path
          key={shape.part}
          d={plainThumbnailShapePath(shape)}
          fill={shape.fill}
          stroke={shape.stroke}
          strokeWidth={shape.stroke ? 1 : undefined}
          data-part={shape.part}
        />
      ))}
    </>
  )
}

/** This fork draws the miniature in its plain look (plainAppearanceThumbnail.ts), not pixel art. */
function AppearanceThumbnail({
  mode,
  scale,
}: {
  mode: AppearanceThumbnailMode
  scale: number
}): React.JSX.Element {
  const clipId = React.useId()
  const { width, height } = APPEARANCE_THUMBNAIL_SIZE
  return (
    <svg
      className="cove-appearance-picker__thumbnail"
      width={width * scale}
      height={height * scale}
      viewBox={`0 0 ${PLAIN_THUMBNAIL_SIZE.width} ${PLAIN_THUMBNAIL_SIZE.height}`}
      aria-hidden="true"
      focusable="false"
    >
      <ThumbnailShapes appearance={mode === 'dark' ? 'dark' : 'light'} />
      {mode === 'system' ? (
        <>
          <clipPath id={clipId}>
            <path d={PLAIN_THUMBNAIL_SYSTEM_SPLIT} />
          </clipPath>
          <g clipPath={`url(#${clipId})`} data-part="system-dark">
            <ThumbnailShapes appearance="dark" />
          </g>
        </>
      ) : null}
    </svg>
  )
}

/**
 * Light, dark or system, each shown as the app in miniature. The options are native radios
 * under one name, so the group takes arrow keys and a single tab stop from the platform. Picking
 * one while a plugin theme is on switches back to Cove in that appearance.
 */
export function AppearancePicker({
  value,
  onValueChange,
  labelledBy,
  label,
  size = 'md',
  testIdPrefix,
  entryRef,
  className,
}: AppearancePickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const name = React.useId()
  const checked = isBuiltinUiTheme(value) ? value : null
  const entry = checked ?? APPEARANCES[0]
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      data-size={size}
      data-testid={testIdPrefix}
      className={classNames('cove-appearance-picker', className)}
    >
      {APPEARANCES.map(appearance => {
        const isChecked = appearance === checked
        return (
          <label
            key={appearance}
            className="cove-appearance-picker__option"
            data-state={isChecked ? 'on' : 'off'}
          >
            <input
              ref={appearance === entry ? entryRef : undefined}
              type="radio"
              className="cove-appearance-picker__input"
              name={name}
              value={appearance}
              checked={isChecked}
              data-testid={`${testIdPrefix}-${appearance}`}
              onChange={() => onValueChange(appearance)}
            />
            <span className="cove-appearance-picker__frame" aria-hidden="true">
              <AppearanceThumbnail mode={appearance} scale={SCALE[size]} />
              {isChecked ? (
                <span className="cove-appearance-picker__check">
                  <CheckIcon size={12} />
                </span>
              ) : null}
            </span>
            <span className="cove-appearance-picker__label">
              {t(`settingsPanel.appearanceNext.${appearance}`)}
            </span>
          </label>
        )
      })}
    </div>
  )
}
