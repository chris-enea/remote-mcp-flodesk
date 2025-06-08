// src/types.ts

// Context from the auth process, encrypted & stored in the auth token
// and provided to the MyMCP as this.props
export type Props = {
  id: string
  name: string
  email: string
  accessToken: string
} 