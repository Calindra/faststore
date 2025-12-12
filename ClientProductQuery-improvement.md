# ClientProductQuery Availability Enhancement

## Executive Summary

This document details the implementation strategy for enhancing the SkuSelector component with real-time product availability data from the ClientProductQuery GraphQL operation. The enhancement will allow users to visually distinguish between available and unavailable product variants, improving user experience and reducing friction in the purchase flow.

---

## Problem Statement

### Current Limitations

**User Experience Issues:**
- Users can select unavailable color variants without visual indication
- No differentiation between in-stock and out-of-stock options
- Users discover unavailability only after selection attempt
- Leads to frustration and abandoned carts

**Technical Limitations:**
- `availableVariations` contains only presentation data (src, alt, label, value)
- No availability or inventory information exposed to UI layer
- `allVariantProducts` array underutilized (contains productID and name only)
- SkuSelector `disabled` prop not being leveraged

### Current Data Structure

```typescript
// Current GraphQL Response
{
  "isVariantOf": {
    "skuVariants": {
      "availableVariations": {
        "Cor": [
          {
            "src": "https://...",
            "alt": "",
            "label": "Cor: 980 - champagne-51",
            "value": "980 - champagne-51"
          }
        ]
      },
      "allVariantProducts": [
        {
          "name": "980 - Champagne-51",
          "productID": "80692"
          // Missing: availability, stock, offers
        }
      ]
    }
  }
}
```

---

## Solution Architecture

### GraphQL Query Enhancement

#### Required Fields

Add the following fields to `allVariantProducts` in the ClientProductQuery:

```graphql
fragment ProductVariant on StoreProduct {
  name
  productID
  # NEW: Availability fields
  offers {
    lowPrice
    offers {
      availability  # Schema.org availability status
      quantity      # Available quantity
      price
      seller {
        identifier
      }
    }
  }
  # OPTIONAL: Additional inventory data
  isVariantOf {
    hasVariant {
      offers {
        offers {
          inventoryLevel {
            value
          }
        }
      }
    }
  }
}
```

#### Complete Query Example

```graphql
query ClientProductQuery($locator: [IStoreSelectedFacet!]!) {
  product(locator: $locator) {
    id
    sku
    name
    gtin
    description
    brand {
      name
    }
    image {
      url
      alternateName
    }
    offers {
      lowPrice
      lowPriceWithTaxes
      offers {
        availability
        listPrice
        price
        priceWithTaxes
        seller {
          identifier
        }
      }
    }
    isVariantOf {
      name
      productGroupID
      skuVariants {
        activeVariations
        slugsMap
        availableVariations
        allVariantProducts {
          name
          productID
          # ENHANCED: Add availability data
          offers {
            lowPrice
            offers {
              availability
              quantity
              inventoryLevel {
                value
              }
              seller {
                identifier
              }
            }
          }
        }
      }
    }
    additionalProperty {
      name
      propertyID
      value
      valueReference
    }
  }
}
```

### Expected Enhanced Response

```typescript
{
  "allVariantProducts": [
    {
      "name": "980 - Champagne-51",
      "productID": "80692",
      "offers": {
        "lowPrice": 40.6,
        "offers": [
          {
            "availability": "https://schema.org/InStock",
            "quantity": 150,
            "inventoryLevel": {
              "value": 150
            },
            "seller": {
              "identifier": "1"
            }
          }
        ]
      }
    },
    {
      "name": "225 - Preto Z25",
      "productID": "70741",
      "offers": {
        "lowPrice": 0,
        "offers": [
          {
            "availability": "https://schema.org/OutOfStock",
            "quantity": 0,
            "inventoryLevel": {
              "value": 0
            },
            "seller": {
              "identifier": "1"
            }
          }
        ]
      }
    }
  ]
}
```

---

## Implementation Strategy

### Phase 1: Availability Map Creation

Create a utility function to build a variant availability lookup map:

```typescript
// src/utils/product/variantAvailability.ts

export type VariantAvailability = {
  isAvailable: boolean;
  quantity: number;
  availability: string;
  lowPrice: number;
};

export type AvailabilityMap = Record<string, VariantAvailability>;

/**
 * Creates a map of variant availability from allVariantProducts
 * @param allVariantProducts - Array of variant product data from GraphQL
 * @returns Map of variant name to availability data
 */
export function createVariantAvailabilityMap(
  allVariantProducts?: Array<{
    name: string;
    productID: string;
    offers?: {
      lowPrice: number;
      offers?: Array<{
        availability?: string;
        quantity?: number;
        inventoryLevel?: {
          value: number;
        };
      }>;
    };
  }>
): AvailabilityMap {
  if (!allVariantProducts) return {};

  return allVariantProducts.reduce((map, variant) => {
    const offer = variant.offers?.offers?.[0];
    const availability = offer?.availability || "";
    const quantity = offer?.quantity ?? offer?.inventoryLevel?.value ?? 0;
    const lowPrice = variant.offers?.lowPrice ?? 0;

    map[variant.name] = {
      isAvailable:
        availability === "https://schema.org/InStock" &&
        quantity > 0 &&
        lowPrice > 0,
      quantity,
      availability,
      lowPrice,
    };

    return map;
  }, {} as AvailabilityMap);
}

/**
 * Checks if a variant option should be disabled
 * @param optionValue - The value of the variant option
 * @param availabilityMap - The availability map created from allVariantProducts
 * @returns true if variant should be disabled
 */
export function isVariantDisabled(
  optionValue: string,
  availabilityMap: AvailabilityMap
): boolean {
  const variantData = availabilityMap[optionValue];

  // If no data found, assume available (fail-safe)
  if (!variantData) return false;

  return !variantData.isAvailable;
}
```

### Phase 2: ProductDetails Component Enhancement

Update `src/components/ProductDetails/ProductDetails.tsx`:

```typescript
import { useMemo } from "react";
import {
  createVariantAvailabilityMap,
  isVariantDisabled
} from "../../utils/product/variantAvailability";

export default function ProductDetails({ product, isValidating }: ProductDetailsProps) {
  // ... existing code ...

  // Create availability map from allVariantProducts
  const variantAvailabilityMap = useMemo(() => {
    if (!isVariantOf?.skuVariants?.allVariantProducts) {
      return {};
    }
    return createVariantAvailabilityMap(
      isVariantOf.skuVariants.allVariantProducts
    );
  }, [isVariantOf?.skuVariants?.allVariantProducts]);

  return (
    <div className="container mx-auto px-4 py-8 font-sans">
      {/* ... existing breadcrumb and image gallery ... */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ... image gallery ... */}

        <div>
          {/* ... product title and ratings ... */}

          {/* ENHANCED: SkuSelector with availability */}
          {isVariantOf?.skuVariants?.availableVariations && (
            <div className="my-4 space-y-4">
              {Object.entries(isVariantOf.skuVariants.availableVariations).map(
                ([propertyName, options]) => {
                  // Enhance options with availability data
                  const enhancedOptions = options.map((opt) => ({
                    src: opt.src,
                    alt: opt.alt || `${propertyName}: ${opt.value}`,
                    label: opt.value,
                    value: opt.value,
                    disabled: isVariantDisabled(opt.value, variantAvailabilityMap),
                  }));

                  return (
                    <div key={propertyName}>
                      <SkuSelector
                        skuPropertyName={propertyName}
                        availableVariations={{ [propertyName]: enhancedOptions as any[] }}
                        activeVariations={isVariantOf.skuVariants!.activeVariations}
                        slugsMap={isVariantOf.skuVariants!.slugsMap}
                        variant="image"
                        ImageComponent={SkuImageComponent}
                      />

                      {/* Optional: Show availability legend */}
                      <p className="text-xs text-gray-500 mt-2">
                        Opções com baixa opacidade estão indisponíveis
                      </p>
                    </div>
                  );
                }
              )}
            </div>
          )}

          {/* ... rest of component ... */}
        </div>
      </div>
    </div>
  );
}
```

### Phase 3: Visual Styling Enhancement

The `@faststore/ui` SkuSelector component applies `data-fs-sku-selector-disabled="true"` to disabled options. Add custom styles:

```css
/* src/styles/components/sku-selector.css */

/**
 * Disabled variant styling
 * Applied when SkuSelector option has disabled: true
 */
[data-fs-sku-selector-option][data-fs-sku-selector-disabled="true"] {
  opacity: 0.4;
  cursor: not-allowed;
  position: relative;
}

[data-fs-sku-selector-option][data-fs-sku-selector-disabled="true"]::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 80%;
  height: 2px;
  background-color: #dc2626; /* red-600 */
  transform: translate(-50%, -50%) rotate(-45deg);
}

[data-fs-sku-selector-option][data-fs-sku-selector-disabled="true"]:hover {
  border-color: #e5e7eb; /* gray-200 */
}

/**
 * Available variant hover enhancement
 */
[data-fs-sku-selector-option]:not([data-fs-sku-selector-disabled="true"]):hover {
  border-color: #A01D1F; /* brand color */
  transform: scale(1.05);
  transition: all 0.2s ease-in-out;
}

/**
 * Low stock indicator (optional)
 * Can be added via custom data attribute
 */
[data-fs-sku-selector-option][data-low-stock="true"]::before {
  content: "!";
  position: absolute;
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  background-color: #f59e0b; /* amber-500 */
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: bold;
  color: white;
}
```

---

## Advanced Features

### Feature 1: Low Stock Warnings

Enhance the utility to support low stock thresholds:

```typescript
// src/utils/product/variantAvailability.ts

export type VariantAvailability = {
  isAvailable: boolean;
  isLowStock: boolean; // NEW
  quantity: number;
  availability: string;
  lowPrice: number;
};

const LOW_STOCK_THRESHOLD = 10; // Configurable threshold

export function createVariantAvailabilityMap(
  allVariantProducts?: Array<{...}>,
  lowStockThreshold: number = LOW_STOCK_THRESHOLD
): AvailabilityMap {
  // ... existing code ...

  map[variant.name] = {
    isAvailable: availability === "https://schema.org/InStock" && quantity > 0 && lowPrice > 0,
    isLowStock: quantity > 0 && quantity <= lowStockThreshold, // NEW
    quantity,
    availability,
    lowPrice,
  };

  return map;
}
```

Apply low stock indicator in component:

```typescript
const enhancedOptions = options.map((opt) => {
  const variantData = variantAvailabilityMap[opt.value];

  return {
    src: opt.src,
    alt: opt.alt || `${propertyName}: ${opt.value}`,
    label: opt.value,
    value: opt.value,
    disabled: isVariantDisabled(opt.value, variantAvailabilityMap),
    // Add custom data attribute for low stock styling
    ...(variantData?.isLowStock && {
      'data-low-stock': 'true'
    }),
  };
});
```

### Feature 2: Availability Tooltip

Add tooltip showing stock quantity:

```typescript
// Install: npm install @radix-ui/react-tooltip

import * as Tooltip from '@radix-ui/react-tooltip';

// Wrap SkuSelector in tooltip provider
<Tooltip.Provider>
  <div key={propertyName}>
    {enhancedOptions.map((opt) => {
      const variantData = variantAvailabilityMap[opt.value];

      return (
        <Tooltip.Root key={opt.value}>
          <Tooltip.Trigger asChild>
            {/* SkuSelector option */}
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="bg-gray-900 text-white px-2 py-1 rounded text-xs">
              {variantData?.isAvailable
                ? `${variantData.quantity} em estoque`
                : 'Indisponível'}
              <Tooltip.Arrow className="fill-gray-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      );
    })}
  </div>
</Tooltip.Provider>
```

### Feature 3: Pre-order Support

Handle pre-order availability status:

```typescript
export function createVariantAvailabilityMap(
  allVariantProducts?: Array<{...}>
): AvailabilityMap {
  // ... existing code ...

  const isInStock = availability === "https://schema.org/InStock";
  const isPreOrder = availability === "https://schema.org/PreOrder";
  const isBackOrder = availability === "https://schema.org/BackOrder";

  map[variant.name] = {
    isAvailable: (isInStock || isPreOrder || isBackOrder) && lowPrice > 0,
    isPreOrder, // NEW
    isBackOrder, // NEW
    isLowStock: quantity > 0 && quantity <= lowStockThreshold,
    quantity,
    availability,
    lowPrice,
  };

  return map;
}
```

---

## Testing Strategy

### Unit Tests

```typescript
// src/utils/product/__tests__/variantAvailability.test.ts

import { describe, it, expect } from 'vitest';
import {
  createVariantAvailabilityMap,
  isVariantDisabled
} from '../variantAvailability';

describe('createVariantAvailabilityMap', () => {
  it('should mark variants as available when in stock', () => {
    const variants = [
      {
        name: "Red",
        productID: "1",
        offers: {
          lowPrice: 50,
          offers: [
            {
              availability: "https://schema.org/InStock",
              quantity: 100,
            }
          ]
        }
      }
    ];

    const map = createVariantAvailabilityMap(variants);

    expect(map["Red"].isAvailable).toBe(true);
    expect(map["Red"].quantity).toBe(100);
  });

  it('should mark variants as unavailable when out of stock', () => {
    const variants = [
      {
        name: "Blue",
        productID: "2",
        offers: {
          lowPrice: 0,
          offers: [
            {
              availability: "https://schema.org/OutOfStock",
              quantity: 0,
            }
          ]
        }
      }
    ];

    const map = createVariantAvailabilityMap(variants);

    expect(map["Blue"].isAvailable).toBe(false);
    expect(map["Blue"].quantity).toBe(0);
  });

  it('should handle missing offer data gracefully', () => {
    const variants = [
      {
        name: "Green",
        productID: "3",
      }
    ];

    const map = createVariantAvailabilityMap(variants);

    expect(map["Green"].isAvailable).toBe(false);
  });

  it('should identify low stock variants', () => {
    const variants = [
      {
        name: "Yellow",
        productID: "4",
        offers: {
          lowPrice: 50,
          offers: [
            {
              availability: "https://schema.org/InStock",
              quantity: 5,
            }
          ]
        }
      }
    ];

    const map = createVariantAvailabilityMap(variants, 10);

    expect(map["Yellow"].isAvailable).toBe(true);
    expect(map["Yellow"].isLowStock).toBe(true);
  });
});

describe('isVariantDisabled', () => {
  it('should return true for unavailable variants', () => {
    const map = {
      "Red": {
        isAvailable: false,
        quantity: 0,
        availability: "https://schema.org/OutOfStock",
        lowPrice: 0,
      }
    };

    expect(isVariantDisabled("Red", map)).toBe(true);
  });

  it('should return false for available variants', () => {
    const map = {
      "Blue": {
        isAvailable: true,
        quantity: 100,
        availability: "https://schema.org/InStock",
        lowPrice: 50,
      }
    };

    expect(isVariantDisabled("Blue", map)).toBe(false);
  });

  it('should default to false when variant not in map', () => {
    const map = {};

    expect(isVariantDisabled("Unknown", map)).toBe(false);
  });
});
```

### Integration Tests

```typescript
// src/components/ProductDetails/__tests__/ProductDetails.integration.test.tsx

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ProductDetails from '../ProductDetails';

describe('ProductDetails - Variant Availability', () => {
  it('should disable out-of-stock variants', () => {
    const product = {
      // ... product data with out-of-stock variant
      isVariantOf: {
        skuVariants: {
          availableVariations: {
            Cor: [
              { value: "Red", src: "...", alt: "", label: "Red" },
              { value: "Blue", src: "...", alt: "", label: "Blue" },
            ]
          },
          allVariantProducts: [
            {
              name: "Red",
              productID: "1",
              offers: {
                lowPrice: 50,
                offers: [{ availability: "https://schema.org/InStock", quantity: 100 }]
              }
            },
            {
              name: "Blue",
              productID: "2",
              offers: {
                lowPrice: 0,
                offers: [{ availability: "https://schema.org/OutOfStock", quantity: 0 }]
              }
            }
          ]
        }
      }
    };

    render(<ProductDetails product={product} />);

    // Check that Blue variant has disabled attribute
    const blueOption = screen.getByTitle("Blue").closest('[data-fs-sku-selector-option]');
    expect(blueOption).toHaveAttribute('data-fs-sku-selector-disabled', 'true');

    // Check that Red variant is not disabled
    const redOption = screen.getByTitle("Red").closest('[data-fs-sku-selector-option]');
    expect(redOption).not.toHaveAttribute('data-fs-sku-selector-disabled', 'true');
  });
});
```

---

## Edge Cases & Considerations

### 1. Multiple Sellers

**Scenario:** Product has multiple sellers with different availability

**Solution:**
```typescript
// Prioritize seller "1" (default seller)
const offer = variant.offers?.offers?.find(o => o.seller?.identifier === "1")
  || variant.offers?.offers?.[0]; // Fallback to first seller

const availability = offer?.availability || "";
const quantity = offer?.quantity ?? 0;
```

### 2. Missing Availability Data

**Scenario:** GraphQL returns null/undefined for availability fields

**Solution:**
```typescript
// Fail-safe: Assume available if no data
export function isVariantDisabled(
  optionValue: string,
  availabilityMap: AvailabilityMap
): boolean {
  const variantData = availabilityMap[optionValue];

  // If no data found, assume available (optimistic UX)
  if (!variantData) {
    console.warn(`No availability data for variant: ${optionValue}`);
    return false;
  }

  return !variantData.isAvailable;
}
```

### 3. Real-time Inventory Updates

**Scenario:** Inventory changes while user is on product page

**Solution:**
```typescript
// Implement polling or WebSocket subscription
import { useEffect } from 'react';

export default function ProductDetails({ product }: ProductDetailsProps) {
  // ... existing code ...

  useEffect(() => {
    // Poll for inventory updates every 30 seconds
    const interval = setInterval(() => {
      // Refetch product data
      // This depends on your data fetching strategy
      // e.g., SWR revalidate, React Query refetch, etc.
    }, 30000);

    return () => clearInterval(interval);
  }, [product.sku]);

  // ... rest of component
}
```

### 4. Variant Name Matching

**Scenario:** Variant names in `availableVariations` don't match `allVariantProducts`

**Solution:**
```typescript
// Add fuzzy matching or normalization
function normalizeVariantName(name: string): string {
  return name.trim().toLowerCase();
}

export function createVariantAvailabilityMap(
  allVariantProducts?: Array<{...}>
): AvailabilityMap {
  // ... existing code ...

  const normalizedKey = normalizeVariantName(variant.name);
  map[normalizedKey] = { /* ... */ };
  map[variant.name] = { /* ... */ }; // Also store original

  return map;
}
```

### 5. Price-Based Availability

**Scenario:** Zero price indicates unavailable product

**Current Implementation:**
```typescript
isAvailable:
  availability === "https://schema.org/InStock" &&
  quantity > 0 &&
  lowPrice > 0, // Zero price = unavailable
```

---

## Performance Optimization

### Memoization Strategy

```typescript
import { useMemo } from 'react';

// Memoize availability map calculation
const variantAvailabilityMap = useMemo(() => {
  if (!isVariantOf?.skuVariants?.allVariantProducts) return {};
  return createVariantAvailabilityMap(
    isVariantOf.skuVariants.allVariantProducts
  );
}, [isVariantOf?.skuVariants?.allVariantProducts]);

// Memoize enhanced options per property
const enhancedVariations = useMemo(() => {
  if (!isVariantOf?.skuVariants?.availableVariations) return {};

  return Object.entries(isVariantOf.skuVariants.availableVariations).reduce(
    (acc, [propertyName, options]) => {
      acc[propertyName] = options.map((opt) => ({
        src: opt.src,
        alt: opt.alt || `${propertyName}: ${opt.value}`,
        label: opt.value,
        value: opt.value,
        disabled: isVariantDisabled(opt.value, variantAvailabilityMap),
      }));
      return acc;
    },
    {} as Record<string, any[]>
  );
}, [isVariantOf?.skuVariants?.availableVariations, variantAvailabilityMap]);
```

---

## Migration Checklist

- [ ] **Phase 1: Backend**
  - [ ] Update GraphQL schema to include availability fields
  - [ ] Add `offers.availability` to `allVariantProducts`
  - [ ] Add `offers.quantity` to `allVariantProducts`
  - [ ] Test GraphQL query in playground
  - [ ] Verify data structure matches expectations

- [ ] **Phase 2: Utilities**
  - [ ] Create `src/utils/product/variantAvailability.ts`
  - [ ] Implement `createVariantAvailabilityMap` function
  - [ ] Implement `isVariantDisabled` function
  - [ ] Write unit tests for utilities
  - [ ] Test edge cases (missing data, multiple sellers)

- [ ] **Phase 3: Component**
  - [ ] Update `ProductDetails.tsx` with availability logic
  - [ ] Add `variantAvailabilityMap` useMemo hook
  - [ ] Enhance SkuSelector options with `disabled` prop
  - [ ] Add availability legend text
  - [ ] Test component rendering

- [ ] **Phase 4: Styling**
  - [ ] Create/update CSS for disabled variants
  - [ ] Add visual indicators (opacity, strikethrough)
  - [ ] Test hover states
  - [ ] Ensure accessibility compliance

- [ ] **Phase 5: Testing**
  - [ ] Write unit tests for utility functions
  - [ ] Write integration tests for component
  - [ ] Perform manual QA testing
  - [ ] Test with various availability scenarios
  - [ ] Validate accessibility (keyboard navigation, screen readers)

- [ ] **Phase 6: Documentation**
  - [ ] Update component documentation
  - [ ] Document GraphQL query changes
  - [ ] Add code comments
  - [ ] Update README if necessary

---

## Rollback Plan

If issues arise post-deployment:

1. **Immediate Rollback:**
   ```typescript
   // In ProductDetails.tsx, temporarily disable availability check
   const enhancedOptions = options.map((opt) => ({
     ...opt,
     disabled: false, // Force all options enabled
   }));
   ```

2. **Feature Flag:**
   ```typescript
   const ENABLE_AVAILABILITY_CHECK = process.env.NEXT_PUBLIC_ENABLE_AVAILABILITY === 'true';

   disabled: ENABLE_AVAILABILITY_CHECK
     ? isVariantDisabled(opt.value, variantAvailabilityMap)
     : false,
   ```

3. **Gradual Rollout:**
   - Deploy to staging environment first
   - Monitor error rates and user behavior
   - A/B test with 10% of users
   - Gradually increase to 100%

---

## Expected Impact

### User Experience
- ✅ Reduced frustration from selecting unavailable variants
- ✅ Faster decision-making with clear availability indicators
- ✅ Improved trust through transparent stock information
- ✅ Lower cart abandonment rates

### Business Metrics
- 📈 Expected 5-10% reduction in cart abandonment
- 📈 Improved conversion rate for in-stock products
- 📈 Reduced support tickets related to availability
- 📉 Lower return rates due to better expectations

### Technical Benefits
- ✅ Leverages existing GraphQL data more effectively
- ✅ Minimal performance impact (memoized calculations)
- ✅ Maintainable and testable code architecture
- ✅ Foundation for future inventory features

---

## Support & Maintenance

### Monitoring

Add logging for availability data quality:

```typescript
export function createVariantAvailabilityMap(
  allVariantProducts?: Array<{...}>
): AvailabilityMap {
  // ... existing code ...

  // Log data quality metrics
  const totalVariants = allVariantProducts.length;
  const variantsWithOffers = allVariantProducts.filter(v => v.offers).length;
  const variantsWithAvailability = allVariantProducts.filter(
    v => v.offers?.offers?.[0]?.availability
  ).length;

  if (process.env.NODE_ENV === 'development') {
    console.log('Variant Availability Stats:', {
      total: totalVariants,
      withOffers: variantsWithOffers,
      withAvailability: variantsWithAvailability,
      coverage: `${((variantsWithAvailability / totalVariants) * 100).toFixed(1)}%`
    });
  }

  return map;
}
```

### Future Enhancements

1. **Inventory Alerts:** Email notifications when low-stock items restock
2. **Predictive Availability:** Machine learning to predict restock dates
3. **Waitlist Integration:** Allow users to join waitlist for out-of-stock variants
4. **Regional Availability:** Show availability based on user location
5. **Bulk Availability:** Show availability for quantity selectors

---

## References

- [Schema.org Availability](https://schema.org/ItemAvailability)
- [VTEX Catalog API Documentation](https://developers.vtex.com/docs/api-reference/catalog-api)
- [FastStore UI Components](https://www.faststore.dev/reference/ui/molecules/SkuSelector)
- [WCAG 2.1 Accessibility Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)

---

**Document Version:** 1.0
**Last Updated:** 2025-12-10
**Author:** Claude Code Analysis
**Status:** Implementation Ready
