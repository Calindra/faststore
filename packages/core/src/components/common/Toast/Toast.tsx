import { useEffect, useRef } from 'react'

import dynamic from 'next/dynamic'

import { useUI } from '@faststore/ui'
import Section from 'src/components/sections/Section/Section'
import { useCart } from 'src/sdk/cart'
import styles from './section.module.scss'

const UIToast = dynamic(
  () =>
    import(/* webpackChunkName: "UIToast" */ '@faststore/ui').then((module) => {
      return module.Toast
    }),
  { ssr: false }
)

function Toast() {
  const { toasts, pushToast } = useUI()
  const { messages } = useCart()
  const processedMessages = useRef(new Set<string>())

  /**
   * Send cart notifications to toast in case the cart
   * returns warnings
   */
  useEffect(() => {
    if (!messages) {
      return
    }

    messages.forEach((message) => {
      // maybe remove the ERROR filter
      if (message.status === 'ERROR') {
        // Create unique key for this message to prevent duplicates
        const messageKey = `${message.status}-${message.text}`

        // Only show if not already processed
        if (!processedMessages.current.has(messageKey)) {
          pushToast({
            message: message.text,
            status: message.status,
          })
          processedMessages.current.add(messageKey)
        }
      }
    })

    // Clear processed messages tracking when cart messages are cleared
    // This prevents the Set from growing indefinitely
    if (messages.length === 0) {
      processedMessages.current.clear()
    }
  }, [messages, pushToast])

  return (
    <>
      {toasts.length > 0 && (
        <Section className={`${styles.section} section-toast`}>
          <UIToast />
        </Section>
      )}
    </>
  )
}

export default Toast
