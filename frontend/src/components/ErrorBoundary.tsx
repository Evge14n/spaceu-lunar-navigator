import { Component, type ReactNode } from 'react'
import { Notice } from './Notice'

/** Keeps the page frame alive if one screen throws. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  render() {
    if (this.state.error)
      return (
        <Notice tone="error" title="This screen hit a problem">
          {this.state.error.message}. Try another site or reload the page.
        </Notice>
      )
    return this.props.children
  }
}
