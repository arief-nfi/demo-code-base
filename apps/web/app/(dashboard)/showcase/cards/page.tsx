'use client';

/**
 * Card Component Usage Examples
 * 
 * This file demonstrates various ways to use the Card component.
 * Copy these examples to your application as needed.
 */

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Button,
  useAuthStore
} from "@saas/ui"
import { Settings, Download, Share2 } from "lucide-react"
import { useEffect } from "react"

// returns BasicCard, CardWithHeaderFooter, CardWithToolbar, CollapsibleCard, CardVariants, CardWithCustomContent, CardFooterAlignments, ResponsiveCardGrid
export default function CardExamples() {
  const storedTenantName = useAuthStore(s => s.tenantName);

  useEffect(() => {
    document.title = `Card Examples | ${storedTenantName || 'SaaS Admin'}`;
  }, [storedTenantName]);

  return (
    <div className="space-y-12">
      <BasicCard />
      <CardWithHeaderFooter />
      <CardWithToolbar />
      <CollapsibleCard />
      <CardVariants />
      <CardWithCustomContent />
      <CardFooterAlignments />
      <ResponsiveCardGrid />
    </div>
  )
} 

// Example 1: Basic Card
export function BasicCard() {
  return (
    <Card>
      <CardContent>
        <p>This is a simple card with just content.</p>
      </CardContent>
    </Card>
  )
}

// Example 2: Card with Header and Footer
export function CardWithHeaderFooter() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>
          This is a description that provides additional context about the card content.
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <p>Your main content goes here. This can be any React component or HTML elements.</p>
      </CardContent>
      
      <CardFooter>
        <Button variant="outline">Cancel</Button>
        <Button>Save Changes</Button>
      </CardFooter>
    </Card>
  )
}

// Example 3: Card with Toolbar in Header
export function CardWithToolbar() {
  return (
    <Card>
      <CardHeader
        toolbar={
          <>
            <Button size="icon" variant="ghost">
              <Share2 className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost">
              <Download className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost">
              <Settings className="h-4 w-4" />
            </Button>
          </>
        }
      >
        <CardTitle>Dashboard Overview</CardTitle>
        <CardDescription>
          View your analytics and performance metrics
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-muted rounded-md">
              <p className="text-sm text-muted-foreground">Total Users</p>
              <p className="text-2xl font-bold">1,234</p>
            </div>
            <div className="p-4 bg-muted rounded-md">
              <p className="text-sm text-muted-foreground">Revenue</p>
              <p className="text-2xl font-bold">$12,345</p>
            </div>
            <div className="p-4 bg-muted rounded-md">
              <p className="text-sm text-muted-foreground">Active Sessions</p>
              <p className="text-2xl font-bold">567</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// Example 4: Collapsible Card
export function CollapsibleCard() {
  return (
    <Card>
      <CardHeader 
        collapsible
        defaultCollapsed={false}
        onCollapseChange={(collapsed) => console.log('Collapsed:', collapsed)}
        toolbar={
          <Button size="sm" variant="outline">
            View Details
          </Button>
        }
      >
        <CardTitle>Collapsible Section</CardTitle>
        <CardDescription>
          Click the chevron icon to expand or collapse this card
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <p>This content will be hidden when the card is collapsed.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Perfect for accordion-style layouts or hiding less important information.
        </p>
      </CardContent>
      
      <CardFooter align="between">
        <span className="text-sm text-muted-foreground">Last updated: 2 hours ago</span>
        <Button size="sm">Update</Button>
      </CardFooter>
    </Card>
  )
}

// Example 5: Card Variants
export function CardVariants() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card variant="default">
        <CardHeader>
          <CardTitle>Default Variant</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Standard card with subtle shadow and border.</p>
        </CardContent>
      </Card>
      
      <Card variant="bordered">
        <CardHeader>
          <CardTitle>Bordered Variant</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Card with a thicker border, no shadow.</p>
        </CardContent>
      </Card>
      
      <Card variant="elevated">
        <CardHeader>
          <CardTitle>Elevated Variant</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Card with a more prominent shadow for emphasis.</p>
        </CardContent>
      </Card>
      
      <Card variant="flat">
        <CardHeader>
          <CardTitle>Flat Variant</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Minimal card with no border or shadow.</p>
        </CardContent>
      </Card>
    </div>
  )
}

// Example 6: Card with Custom Content
export function CardWithCustomContent() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Product Card</CardTitle>
        <CardDescription>Premium wireless headphones</CardDescription>
      </CardHeader>
      
      <CardContent padded={false}>
        <img 
          src="https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&h=400&fit=scale" 
          alt="Premium Wireless Headphones" 
          className="w-full h-120 object-cover"
        />
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-2xl font-bold">$299.99</span>
            <span className="text-sm text-muted-foreground">In Stock</span>
          </div>
          <ul className="space-y-2 text-sm">
            <li>✓ Active Noise Cancellation</li>
            <li>✓ 30-hour battery life</li>
            <li>✓ Bluetooth 5.0</li>
            <li>✓ Premium sound quality</li>
          </ul>
        </div>
      </CardContent>
      
      <CardFooter align="between">
        <Button variant="outline">Add to Wishlist</Button>
        <Button>Add to Cart</Button>
      </CardFooter>
    </Card>
  )
}

// Example 7: Footer Alignment Options
export function CardFooterAlignments() {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent>
          <p>Footer aligned to start</p>
        </CardContent>
        <CardFooter align="start">
          <Button>Action</Button>
        </CardFooter>
      </Card>
      
      <Card>
        <CardContent>
          <p>Footer aligned to center</p>
        </CardContent>
        <CardFooter align="center">
          <Button>Action</Button>
        </CardFooter>
      </Card>
      
      <Card>
        <CardContent>
          <p>Footer aligned to end (default)</p>
        </CardContent>
        <CardFooter align="end">
          <Button>Action</Button>
        </CardFooter>
      </Card>
      
      <Card>
        <CardContent>
          <p>Footer with space between</p>
        </CardContent>
        <CardFooter align="between">
          <Button variant="outline">Cancel</Button>
          <Button>Confirm</Button>
        </CardFooter>
      </Card>
    </div>
  )
}

// Example 8: Responsive Card Grid
export function ResponsiveCardGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3, 4, 5, 6].map((item) => (
        <Card key={item}>
          <CardHeader>
            <CardTitle>Card {item}</CardTitle>
            <CardDescription>
              Description for card {item}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              This demonstrates how cards look in a responsive grid layout.
            </p>
          </CardContent>
          <CardFooter>
            <Button size="sm" className="w-full sm:w-auto">View More</Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
