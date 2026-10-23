using Contoso.Outdoor.Domain;
using Microsoft.EntityFrameworkCore;

namespace Contoso.Outdoor.Data.Core;

/// <summary>EF Core view of the schema EF6 created. The database is authoritative: map names explicitly, never migrate.</summary>
public sealed class OutdoorDbContext(DbContextOptions<OutdoorDbContext> options) : DbContext(options)
{
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Order> Orders => Set<Order>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Product>(product =>
        {
            product.ToTable("Products");
            product.Property(p => p.Price).HasPrecision(19, 4);
        });

        modelBuilder.Entity<Order>(order =>
        {
            order.ToTable("Orders");
            order.Property(o => o.Total).HasPrecision(19, 4);
            order.Property(o => o.Status).HasConversion<int>();
            order.OwnsOne(o => o.DeliveryAddress, address =>
            {
                address.Property(a => a.Name).HasColumnName("DeliveryAddress_Name");
                address.Property(a => a.Street).HasColumnName("DeliveryAddress_Street");
                address.Property(a => a.PostalCode).HasColumnName("DeliveryAddress_PostalCode");
                address.Property(a => a.City).HasColumnName("DeliveryAddress_City");
            });
            // EF6 created an independent association, so the key column is Order_Id, not OrderId.
            order.HasMany(o => o.Lines).WithOne().HasForeignKey("Order_Id").IsRequired();
        });

        modelBuilder.Entity<OrderLine>(line =>
        {
            line.ToTable("OrderLines");
            line.Property(l => l.UnitPrice).HasPrecision(19, 4);
        });
    }
}